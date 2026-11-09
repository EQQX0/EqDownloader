import type { DownloadItem, Engine, Preset, ProbeResult } from '../engine';
import type { AppUpdater } from '../engine/getEngine';
import { extractUrl } from '../lib/url';
import { asEngineError, describeError, NO_LINK, type UiError } from './errors';

export type Screen = 'home' | 'downloads' | 'library' | 'settings';
export const PRESET_LIST: readonly Preset[] = ['best', '1080p', '720p', 'mp3', 'm4a'];

export interface Settings {
  destination: string;
  preset: Preset;
  engineVersion: string | null;
  appVersion: string | null;
  /** Pick up a link from the clipboard when the app comes to the front. */
  autoPaste: boolean;
  /** Paste checks the link straight away; off, it only fills the field. */
  pasteFinds: boolean;
  /** A pasted link that checks out is downloaded at the default quality with no tap. */
  pasteAutoDownload: boolean;
}

export type PasteOption = 'autoPaste' | 'pasteFinds' | 'pasteAutoDownload';

/** Progress of the app's own update; only used when the shell can update itself. */
export type AppUpdateState = 'idle' | 'checking' | 'current' | 'available' | 'installing' | 'installed';

export interface State {
  screen: Screen;
  probe: ProbeResult | null;
  probing: boolean;
  items: DownloadItem[];
  /** Finished downloads, newest first. Kept on the device so an app update or restart does not clear them. */
  library: DownloadItem[];
  error: UiError | null;
  settings: Settings;
  appUpdate: { status: AppUpdateState; version: string | null };
}

/** Platform extras. Everything is optional so the browser and fake engine work with none. */
export interface Host {
  getDefaultFolder?: () => Promise<string>;
  chooseFolder?: () => Promise<string | null>;
  revealFile?: (path: string) => Promise<void>;
  openSupport?: () => Promise<void>;
  /** The shell's own log (Android keeps one), appended to the app's log in Settings. */
  readDebugLog?: () => Promise<string>;
  clearDebugLog?: () => Promise<void>;
  appUpdater?: AppUpdater;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface Store {
  readonly state: Readonly<State>;
  readonly ready: Promise<void>;
  readonly canChooseFolder: boolean;
  readonly canReveal: boolean;
  readonly canUpdateApp: boolean;
  readonly canOpenSupport: boolean;
  /** True when the shell can read the clipboard itself (Android), so the paste settings apply. */
  readonly canReadClipboard: boolean;
  openSupport(): Promise<void>;
  setPasteOption(key: PasteOption, value: boolean): void;
  /** The clipboard text, read by the shell when it can (Android) or by the browser; empty when it cannot be read. */
  readClipboard(): Promise<string>;
  /** Everything traceable about failures: the app's own notes plus the shell's log when there is one. */
  debugLog(): Promise<string>;
  clearDebugLog(): Promise<void>;
  /** `fromPaste` marks a link that came from the clipboard or Paste button, so "paste auto-downloads" may apply. */
  submitLink(text: string, opts?: { fromPaste?: boolean }): Promise<void>;
  startDownload(preset: Preset): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  updateEngine(): Promise<void>;
  checkAppUpdate(): Promise<void>;
  installAppUpdate(): Promise<void>;
  chooseFolder(): Promise<void>;
  revealFile(path: string): Promise<void>;
  setPreset(preset: Preset): void;
  go(screen: Screen): void;
  subscribe(fn: () => void): () => void;
}

const KEY_DEST = 'eq.destination';
const KEY_PRESET = 'eq.preset';
const KEY_DEBUG = 'eq.debug';
const PASTE_KEYS: Record<PasteOption, string> = {
  autoPaste: 'eq.autoPaste',
  pasteFinds: 'eq.pasteFinds',
  pasteAutoDownload: 'eq.pasteAutoDownload',
};
const DEBUG_MAX = 40_000;
const KEY_LIBRARY = 'eq.library';
const LIBRARY_MAX = 200;

const libraryKey = (i: DownloadItem): string => `${i.url}|${i.filePath ?? ''}`;

/** Reads the saved library, keeping only well-formed entries. */
function parseLibrary(raw: string | null): DownloadItem[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const out: DownloadItem[] = [];
    for (const e of list) {
      const o = e as Record<string, unknown>;
      if (typeof o?.id !== 'string' || typeof o.url !== 'string' || typeof o.title !== 'string') continue;
      out.push({
        id: o.id, url: o.url, title: o.title.slice(0, 300),
        preset: PRESET_LIST.includes(o.preset as Preset) ? (o.preset as Preset) : 'best',
        state: 'done', percent: 100, speedBps: null, etaSec: null,
        filePath: typeof o.filePath === 'string' ? o.filePath : null,
        error: null,
        thumbnail: typeof o.thumbnail === 'string' ? o.thumbnail : null,
        tookMs: typeof o.tookMs === 'number' && o.tookMs >= 0 ? o.tookMs : undefined,
      });
      if (out.length >= LIBRARY_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

function defaultStorage(): Host['storage'] {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createStore(engine: Engine, host: Host = {}): Store {
  const storage = host.storage === undefined ? defaultStorage() : host.storage;
  const read = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const write = (k: string, v: string): void => {
    try {
      storage?.setItem(k, v);
    } catch {
      // Storage may be unavailable; the setting then lasts for this session only.
    }
  };

  const savedPreset = read(KEY_PRESET);
  const state: State = {
    screen: 'home',
    probe: null,
    probing: false,
    items: [],
    library: parseLibrary(read(KEY_LIBRARY)),
    error: null,
    settings: {
      destination: read(KEY_DEST) ?? 'Downloads',
      preset: PRESET_LIST.includes(savedPreset as Preset) ? (savedPreset as Preset) : 'best',
      engineVersion: null,
      appVersion: null,
      autoPaste: read(PASTE_KEYS.autoPaste) !== 'false',
      pasteFinds: read(PASTE_KEYS.pasteFinds) !== 'false',
      pasteAutoDownload: read(PASTE_KEYS.pasteAutoDownload) === 'true',
    },
    appUpdate: { status: 'idle', version: null },
  };

  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const fn of [...listeners]) fn();
  };
  const set = (patch: Partial<State>): void => {
    Object.assign(state, patch);
    emit();
  };

  // The engine's item.title is the URL until the download ends, so titles come from the probe.
  const titles = new Map<string, string>();
  const thumbs = new Map<string, string>();
  const withTitle = (item: DownloadItem): DownloadItem => {
    const t = titles.get(item.id);
    const pic = thumbs.get(item.id);
    return t || pic ? { ...item, title: t ?? item.title, thumbnail: pic ?? item.thumbnail ?? null } : item;
  };
  const remember = (item: DownloadItem): void => {
    if (item.state !== 'done') return;
    const key = libraryKey(item);
    const library = [item, ...state.library.filter((i) => libraryKey(i) !== key)].slice(0, LIBRARY_MAX);
    state.library = library;
    write(KEY_LIBRARY, JSON.stringify(library.map(({ id, url, title, preset, filePath, thumbnail, tookMs }) => ({ id, url, title, preset, filePath, thumbnail, tookMs }))));
  };
  // While something is downloading the screens redraw once a second so the timers run.
  let tick: ReturnType<typeof setInterval> | null = null;
  const syncTick = (): void => {
    const active = state.items.some((i) => i.state === 'queued' || i.state === 'running');
    if (active && !tick) tick = setInterval(emit, 1000);
    else if (!active && tick) {
      clearInterval(tick);
      tick = null;
    }
  };
  // The engines' time-left estimates jump around. This keeps a smoothed value that counts down between updates
  // and moves only a fifth of the way toward each new estimate.
  const etaSmooth = new Map<string, { eta: number; at: number }>();
  const smoothEta = (id: string, raw: number | null | undefined, now: number): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return etaSmooth.get(id) ? Math.max(0, Math.round(etaSmooth.get(id)!.eta - (now - etaSmooth.get(id)!.at) / 1000)) : null;
    const prev = etaSmooth.get(id);
    const counted = prev ? Math.max(0, prev.eta - (now - prev.at) / 1000) : raw;
    const eta = prev ? counted * 0.8 + raw * 0.2 : raw;
    etaSmooth.set(id, { eta, at: now });
    return Math.round(eta);
  };
  /** Adds one line to the app's debug log, kept on the device and cut to its newest part. */
  const note = (tag: string, text: string): void => {
    const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} [${tag}] ${text.replace(/\s+/g, ' ').slice(0, 600)}\n`;
    write(KEY_DEBUG, ((read(KEY_DEBUG) ?? '') + line).slice(-DEBUG_MAX));
  };
  const upsert = (item: DownloadItem): void => {
    const idx = state.items.findIndex((i) => i.id === item.id);
    const prevItem = idx >= 0 ? state.items[idx] : undefined;
    const now = Date.now();
    const ended = item.state === 'done' || item.state === 'failed' || item.state === 'cancelled';
    const startedAt = prevItem?.startedAt ?? now;
    const finishedAt = ended ? (prevItem?.finishedAt ?? now) : undefined;
    if (item.state === 'running') item = { ...item, etaSec: smoothEta(item.id, item.etaSec, now) };
    else etaSmooth.delete(item.id);
    const next = withTitle({ ...item, startedAt, finishedAt, tookMs: finishedAt ? finishedAt - startedAt : undefined });
    remember(next);
    const items = idx >= 0 ? state.items.map((i, n) => (n === idx ? next : i)) : [...state.items, next];
    const wasFailed = idx >= 0 && state.items[idx]!.state === 'failed';
    const patch: Partial<State> = { items };
    if (next.state === 'failed' && !wasFailed && next.error) {
      note('failed', `${next.error.code}: ${next.error.message} | ${next.url} | ${next.preset} | app ${state.settings.appVersion ?? '?'} engine ${state.settings.engineVersion ?? '?'}`);
      const ui = describeError(next.error, state.settings.destination);
      if (ui.offerUpdate) patch.error = ui;
    }
    set(patch);
    syncTick();
  };

  // When the engine says it is out of date, update it once per session and try again. This is the only time
  // the app contacts GitHub without a button press, and only after a download or probe already failed that way.
  let autoUpdated = false;
  const autoUpdate = async (): Promise<boolean> => {
    if (autoUpdated) return false;
    autoUpdated = true;
    try {
      const v = await engine.updateEngine();
      state.settings = { ...state.settings, engineVersion: v };
      note('engine', `updated automatically to ${v} after an out-of-date failure`);
      return true;
    } catch (e) {
      note('engine', `automatic update failed: ${asEngineError(e).message}`);
      return false;
    }
  };

  const upsertThenRecover = (item: DownloadItem): void => {
    const prev = state.items.find((i) => i.id === item.id);
    upsert(item);
    if (item.state === 'failed' && item.error?.code === 'outdated' && prev?.state !== 'failed' && !autoUpdated) {
      const title = titles.get(item.id) ?? (item.title !== item.url ? item.title : null);
      void autoUpdate().then((ok) => {
        if (!ok) return;
        set({ error: null });
        void begin(item.url, item.preset, title, thumbs.get(item.id) ?? item.thumbnail ?? null);
      });
    }
  };

  engine.onProgress(upsertThenRecover);

  const ready = (async () => {
    if (read(KEY_DEST) === null && host.getDefaultFolder) {
      try {
        const dest = await host.getDefaultFolder();
        if (dest) state.settings.destination = dest;
      } catch {
        // Keep the placeholder destination.
      }
    }
    if (host.appUpdater) {
      try {
        state.settings.appVersion = await host.appUpdater.version();
      } catch {
        // The row then shows no version.
      }
    }
    try {
      for (const item of await engine.list()) {
        if (!state.items.some((i) => i.id === item.id)) state.items.push(withTitle(item));
        remember(withTitle(item));
      }
    } catch {
      // An empty queue is fine if the engine cannot list yet.
    }
    emit();
  })();

  let probeSeq = 0;

  // A name and picture can arrive after the user already pressed Download. They still go into that download,
  // whether or not the result card is shown any more.
  const applyMeta = (url: string, title: string, thumbnail: string | null): void => {
    let touched = false;
    for (const i of state.items) {
      if (i.url !== url) continue;
      const cur = titles.get(i.id);
      if (title && (!cur || cur === url)) titles.set(i.id, title);
      if (thumbnail && !thumbs.has(i.id)) thumbs.set(i.id, thumbnail);
      touched = true;
    }
    if (touched) set({ items: state.items.map(withTitle) });
  };

  async function begin(url: string, preset: Preset, title: string | null, thumbnail: string | null = null): Promise<void> {
    await ready;
    try {
      const id = await engine.start(url, preset, state.settings.destination);
      if (title) titles.set(id, title);
      if (thumbnail) thumbs.set(id, thumbnail);
      const seen = state.items.find((i) => i.id === id);
      if (seen) upsert(seen);
      else {
        upsert({
          id, url, title: title ?? url, preset, state: 'queued', percent: 0,
          speedBps: null, etaSec: null, filePath: null, error: null,
        });
      }
    } catch (e) {
      const ui = describeError(asEngineError(e), state.settings.destination);
      if (ui.code === 'disk' && host.chooseFolder) {
        set({ error: { ...ui, message: `${ui.message} Choose the folder again.`, offerChoose: true } });
      } else {
        set({ error: ui });
      }
    }
  }

  let starting = false;

  async function startDownload(preset: Preset): Promise<void> {
    const probe = state.probe;
    if (!probe || starting) return;
    starting = true;
    probeSeq++; // a late answer for this link must not bring the result back after the download starts
    try {
      set({ error: null });
      await begin(probe.url, preset, probe.title, probe.thumbnail ?? null);
      if (!state.error) set({ probe: null, screen: 'downloads' });
    } finally {
      starting = false;
    }
  }

  return {
    state,
    ready,
    canChooseFolder: typeof host.chooseFolder === 'function',
    canReveal: typeof host.revealFile === 'function',
    canUpdateApp: !!host.appUpdater,
    canOpenSupport: typeof host.openSupport === 'function',
    canReadClipboard: (() => {
      const e = engine as Engine & { readClipboard?: unknown; onClipboard?: unknown };
      return typeof e.readClipboard === 'function' || typeof e.onClipboard === 'function';
    })(),
    setPasteOption(key, value) {
      write(PASTE_KEYS[key], String(value));
      set({ settings: { ...state.settings, [key]: value } });
    },
    async readClipboard() {
      try {
        const rc = (engine as Engine & { readClipboard?(): Promise<string> }).readClipboard;
        if (typeof rc === 'function') return await rc.call(engine);
        return (await navigator.clipboard?.readText?.()) ?? '';
      } catch {
        return '';
      }
    },
    async debugLog() {
      let native = '';
      try {
        native = (await host.readDebugLog?.()) ?? '';
      } catch {
        // The shell has no log to show.
      }
      const app = read(KEY_DEBUG) ?? '';
      return [`App ${state.settings.appVersion ?? 'unknown'}, engine ${state.settings.engineVersion ?? 'unknown'}`, app && `--- app ---\n${app}`, native && `--- shell ---\n${native}`]
        .filter(Boolean)
        .join('\n\n');
    },
    async clearDebugLog() {
      write(KEY_DEBUG, '');
      try {
        await host.clearDebugLog?.();
      } catch {
        // Nothing to clear in the shell.
      }
    },
    async openSupport() {
      try {
        await host.openSupport?.();
      } catch {
        // The browser could not open; nothing else to do.
      }
    },

    async submitLink(text, opts) {
      const url = extractUrl(text);
      if (!url) {
        probeSeq++; // a slower earlier probe must not overwrite this result
        set({ error: NO_LINK, probe: null, probing: false });
        return;
      }
      const seq = ++probeSeq;
      // Paste auto-download: once the link checks out, start it at the default quality. Needs "paste finds" on.
      const autoStart = (s: number): void => {
        const { pasteFinds, pasteAutoDownload, preset } = state.settings;
        if (opts?.fromPaste && pasteFinds && pasteAutoDownload && s === probeSeq) void startDownload(preset);
      };
      // Show the quality buttons at once with the link as the title; the real title and picture fill in when yt-dlp answers.
      set({ error: null, probe: { url, title: url, thumbnail: null, durationSec: null, formats: [] }, probing: true });
      try {
        // Title and picture from the site's own quick lookup (a fraction of a second) when the engine has one;
        // the full yt-dlp check only runs when that gives nothing.
        const quick = (engine as Engine & { quickInfo?(url: string): Promise<{ title: string; thumbnail: string | null }> }).quickInfo;
        if (typeof quick === 'function') {
          try {
            const q = await quick.call(engine, url);
            if (q.title) {
              applyMeta(url, q.title, q.thumbnail ?? null);
              if (seq === probeSeq) {
                set({ probe: { url, title: q.title, thumbnail: q.thumbnail ?? null, durationSec: null, formats: [] }, probing: false });
                autoStart(seq);
              }
              return;
            }
          } catch {
            // No quick answer for this site: do the full check below.
          }
        }
        let probe;
        try {
          probe = await engine.probe(url);
        } catch (first) {
          if (asEngineError(first).code !== 'outdated' || !(await autoUpdate())) throw first;
          probe = await engine.probe(url);
        }
        applyMeta(url, probe.title, probe.thumbnail ?? null);
        if (seq === probeSeq) {
          set({ probe, probing: false });
          autoStart(seq);
        }
      } catch (e) {
        if (seq === probeSeq) {
          set({ probe: null, probing: false, error: describeError(asEngineError(e), state.settings.destination) });
        }
      }
    },

    startDownload,

    async cancel(id) {
      try {
        await engine.cancel(id);
      } catch (e) {
        set({ error: describeError(asEngineError(e), state.settings.destination) });
      }
    },

    async retry(id) {
      const old = state.items.find((i) => i.id === id);
      if (!old || old.state !== 'failed') return;
      set({ error: null });
      await begin(old.url, old.preset, titles.get(id) ?? (old.title !== old.url ? old.title : null), old.thumbnail ?? null);
    },

    async updateEngine() {
      try {
        const v = await engine.updateEngine();
        set({ settings: { ...state.settings, engineVersion: v }, error: state.error?.offerUpdate ? null : state.error });
      } catch (e) {
        set({ error: describeError(asEngineError(e), state.settings.destination) });
      }
    },

    async checkAppUpdate() {
      const u = host.appUpdater;
      if (!u || state.appUpdate.status === 'checking' || state.appUpdate.status === 'installing') return;
      set({ appUpdate: { status: 'checking', version: null } });
      try {
        const found = await u.check();
        set({ appUpdate: found ? { status: 'available', version: found.version } : { status: 'current', version: null } });
      } catch (e) {
        set({ appUpdate: { status: 'idle', version: null }, error: describeError(asEngineError(e), state.settings.destination) });
      }
    },

    async installAppUpdate() {
      const u = host.appUpdater;
      if (!u || state.appUpdate.status !== 'available') return;
      const version = state.appUpdate.version;
      set({ appUpdate: { status: 'installing', version } });
      try {
        await u.install();
        set({ appUpdate: { status: 'installed', version } });
      } catch (e) {
        set({ appUpdate: { status: 'available', version }, error: describeError(asEngineError(e), state.settings.destination) });
      }
    },

    async chooseFolder() {
      if (!host.chooseFolder) return;
      try {
        const picked = await host.chooseFolder();
        if (!picked) return;
        write(KEY_DEST, picked);
        set({
          settings: { ...state.settings, destination: picked },
          error: state.error?.offerChoose ? null : state.error,
        });
      } catch (e) {
        set({ error: describeError(asEngineError(e), state.settings.destination) });
      }
    },

    async revealFile(path) {
      try {
        await host.revealFile?.(path);
      } catch (e) {
        set({ error: describeError(asEngineError(e), state.settings.destination) });
      }
    },

    setPreset(preset) {
      write(KEY_PRESET, preset);
      set({ settings: { ...state.settings, preset } });
    },

    go(screen) {
      set({ screen, error: null });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
