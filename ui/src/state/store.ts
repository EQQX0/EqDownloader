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
}

/** Progress of the app's own update; only used when the shell can update itself. */
export type AppUpdateState = 'idle' | 'checking' | 'current' | 'available' | 'installing' | 'installed';

export interface State {
  screen: Screen;
  probe: ProbeResult | null;
  probing: boolean;
  items: DownloadItem[];
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
  openSupport(): Promise<void>;
  submitLink(text: string): Promise<void>;
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
    error: null,
    settings: {
      destination: read(KEY_DEST) ?? 'Downloads',
      preset: PRESET_LIST.includes(savedPreset as Preset) ? (savedPreset as Preset) : 'best',
      engineVersion: null,
      appVersion: null,
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
  const withTitle = (item: DownloadItem): DownloadItem => {
    const t = titles.get(item.id);
    return t ? { ...item, title: t } : item;
  };
  const upsert = (item: DownloadItem): void => {
    const next = withTitle(item);
    const idx = state.items.findIndex((i) => i.id === item.id);
    const items = idx >= 0 ? state.items.map((i, n) => (n === idx ? next : i)) : [...state.items, next];
    const wasFailed = idx >= 0 && state.items[idx]!.state === 'failed';
    const patch: Partial<State> = { items };
    if (next.state === 'failed' && !wasFailed && next.error) {
      const ui = describeError(next.error, state.settings.destination);
      if (ui.offerUpdate) patch.error = ui;
    }
    set(patch);
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
      return true;
    } catch {
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
        void begin(item.url, item.preset, title);
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
      }
    } catch {
      // An empty queue is fine if the engine cannot list yet.
    }
    emit();
  })();

  let probeSeq = 0;

  async function begin(url: string, preset: Preset, title: string | null): Promise<void> {
    await ready;
    try {
      const id = await engine.start(url, preset, state.settings.destination);
      if (title) titles.set(id, title);
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

  return {
    state,
    ready,
    canChooseFolder: typeof host.chooseFolder === 'function',
    canReveal: typeof host.revealFile === 'function',
    canUpdateApp: !!host.appUpdater,
    canOpenSupport: typeof host.openSupport === 'function',
    async openSupport() {
      try {
        await host.openSupport?.();
      } catch {
        // The browser could not open; nothing else to do.
      }
    },

    async submitLink(text) {
      const url = extractUrl(text);
      if (!url) {
        probeSeq++; // a slower earlier probe must not overwrite this result
        set({ error: NO_LINK, probe: null, probing: false });
        return;
      }
      const seq = ++probeSeq;
      set({ error: null, probe: null, probing: true });
      try {
        let probe;
        try {
          probe = await engine.probe(url);
        } catch (first) {
          if (asEngineError(first).code !== 'outdated' || !(await autoUpdate())) throw first;
          probe = await engine.probe(url);
        }
        if (seq === probeSeq) set({ probe, probing: false });
      } catch (e) {
        if (seq === probeSeq) {
          set({ probing: false, error: describeError(asEngineError(e), state.settings.destination) });
        }
      }
    },

    async startDownload(preset) {
      const probe = state.probe;
      if (!probe || starting) return;
      starting = true;
      try {
        set({ error: null });
        await begin(probe.url, preset, probe.title);
        if (!state.error) set({ probe: null, screen: 'downloads' });
      } finally {
        starting = false;
      }
    },

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
      await begin(old.url, old.preset, titles.get(id) ?? (old.title !== old.url ? old.title : null));
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
