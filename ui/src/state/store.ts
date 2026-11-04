import type { DownloadItem, Engine, Preset, ProbeResult } from '../engine';
import { extractUrl } from '../lib/url';
import { asEngineError, describeError, NO_LINK, type UiError } from './errors';

export type Screen = 'home' | 'downloads' | 'library' | 'settings';
export const PRESET_LIST: readonly Preset[] = ['best', '1080p', '720p', 'mp3', 'm4a'];

export interface Settings {
  destination: string;
  preset: Preset;
  engineVersion: string | null;
}

export interface State {
  screen: Screen;
  probe: ProbeResult | null;
  probing: boolean;
  items: DownloadItem[];
  error: UiError | null;
  settings: Settings;
}

/** Platform extras. Everything is optional so the browser and fake engine work with none. */
export interface Host {
  getDefaultFolder?: () => Promise<string>;
  chooseFolder?: () => Promise<string | null>;
  revealFile?: (path: string) => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface Store {
  readonly state: Readonly<State>;
  readonly ready: Promise<void>;
  readonly canChooseFolder: boolean;
  readonly canReveal: boolean;
  submitLink(text: string): Promise<void>;
  startDownload(preset: Preset): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  updateEngine(): Promise<void>;
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
    },
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

  engine.onProgress(upsert);

  const ready = (async () => {
    if (read(KEY_DEST) === null && host.getDefaultFolder) {
      try {
        const dest = await host.getDefaultFolder();
        if (dest) state.settings.destination = dest;
      } catch {
        // Keep the placeholder destination.
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
      set({ error: describeError(asEngineError(e), state.settings.destination) });
    }
  }

  return {
    state,
    ready,
    canChooseFolder: typeof host.chooseFolder === 'function',
    canReveal: typeof host.revealFile === 'function',

    async submitLink(text) {
      const url = extractUrl(text);
      if (!url) {
        set({ error: NO_LINK, probe: null, probing: false });
        return;
      }
      const seq = ++probeSeq;
      set({ error: null, probe: null, probing: true });
      try {
        const probe = await engine.probe(url);
        if (seq === probeSeq) set({ probe, probing: false });
      } catch (e) {
        if (seq === probeSeq) {
          set({ probing: false, error: describeError(asEngineError(e), state.settings.destination) });
        }
      }
    },

    async startDownload(preset) {
      const probe = state.probe;
      if (!probe) return;
      set({ error: null });
      await begin(probe.url, preset, probe.title);
      if (!state.error) set({ probe: null, screen: 'downloads' });
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

    async chooseFolder() {
      if (!host.chooseFolder) return;
      try {
        const picked = await host.chooseFolder();
        if (!picked) return;
        write(KEY_DEST, picked);
        set({ settings: { ...state.settings, destination: picked } });
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
