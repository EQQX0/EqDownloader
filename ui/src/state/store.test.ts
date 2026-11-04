import { describe, expect, it, vi } from 'vitest';
import type { DownloadItem, Engine, EngineError, Preset, ProbeResult } from '../engine';
import { formatEta, formatPercent, formatSpeed } from '../lib/format';
import { describeError } from './errors';
import { createStore, type Host } from './store';

class TestEngine implements Engine {
  probeCalls: string[] = [];
  startCalls: Array<{ url: string; preset: Preset; destination: string }> = [];
  cancelCalls: string[] = [];
  probeError: EngineError | null = null;
  startError: EngineError | null = null;
  title = 'Probe title';
  updateResult = '2026.01.01';
  items: DownloadItem[] = [];
  private handlers = new Set<(i: DownloadItem) => void>();
  private seq = 0;

  probeGate: Promise<void> | null = null;
  startGate: Promise<void> | null = null;

  async probe(url: string): Promise<ProbeResult> {
    this.probeCalls.push(url);
    if (this.probeGate) await this.probeGate;
    if (this.probeError) throw this.probeError;
    return { url, title: this.title, thumbnail: null, durationSec: 10, formats: [] };
  }
  async start(url: string, preset: Preset, destination: string): Promise<string> {
    this.startCalls.push({ url, preset, destination });
    if (this.startGate) await this.startGate;
    if (this.startError) throw this.startError;
    const id = `t-${++this.seq}`;
    this.items.push(mk(id, url, preset));
    return id;
  }
  async cancel(id: string): Promise<void> {
    this.cancelCalls.push(id);
    this.emit({ ...this.find(id), state: 'cancelled' });
  }
  async list(): Promise<DownloadItem[]> {
    return this.items.map((i) => ({ ...i }));
  }
  async updateEngine(): Promise<string> {
    return this.updateResult;
  }
  onProgress(h: (i: DownloadItem) => void): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  find(id: string): DownloadItem {
    return this.items.find((i) => i.id === id)!;
  }
  emit(item: DownloadItem): void {
    const idx = this.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) this.items[idx] = item;
    for (const h of this.handlers) h({ ...item });
  }
}

function mk(id: string, url: string, preset: Preset): DownloadItem {
  return { id, url, title: url, preset, state: 'queued', percent: 0, speedBps: null, etaSec: null, filePath: null, error: null };
}

const memStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

async function setup(host: Host = {}) {
  const engine = new TestEngine();
  const store = createStore(engine, { storage: memStorage(), ...host });
  await store.ready;
  return { engine, store };
}

describe('submitLink', () => {
  it('sets "No link found." and makes zero probe calls for text without a URL', async () => {
    const { engine, store } = await setup();
    await store.submitLink('hello');
    expect(engine.probeCalls).toHaveLength(0);
    expect(store.state.error?.message).toBe('No link found.');
    expect(store.state.probe).toBeNull();
  });

  it('probes the extracted URL and keeps the result', async () => {
    const { engine, store } = await setup();
    await store.submitLink('Watch https://a.test/v now');
    expect(engine.probeCalls).toEqual(['https://a.test/v']);
    expect(store.state.probe?.title).toBe('Probe title');
    expect(store.state.error).toBeNull();
  });

  it('maps an unsupported probe error and offers the engine update', async () => {
    const { engine, store } = await setup();
    engine.probeError = { code: 'unsupported', message: 'x' };
    await store.submitLink('https://a.test/v');
    expect(store.state.error?.message).toBe('This site is not supported.');
    expect(store.state.error?.offerUpdate).toBe(true);
    expect(store.state.probe).toBeNull();
  });

  it('maps outdated to the update offer', async () => {
    const { engine, store } = await setup();
    engine.probeError = { code: 'outdated', message: 'x' };
    await store.submitLink('https://a.test/v');
    expect(store.state.error?.message).toBe('The download engine is out of date.');
    expect(store.state.error?.offerUpdate).toBe(true);
  });

  it('keeps the engine message for blocked and offers no update', async () => {
    const { engine, store } = await setup();
    engine.probeError = { code: 'blocked', message: 'Sign in to confirm your age' };
    await store.submitLink('https://a.test/v');
    expect(store.state.error?.message).toContain('Sign in to confirm your age');
    expect(store.state.error?.offerUpdate).toBe(false);
  });

  it('updateEngine stores the version and clears an update-offering error', async () => {
    const { engine, store } = await setup();
    engine.probeError = { code: 'outdated', message: 'x' };
    await store.submitLink('https://a.test/v');
    await store.updateEngine();
    expect(store.state.settings.engineVersion).toBe('2026.01.01');
    expect(store.state.error).toBeNull();
  });
});

describe('describeError', () => {
  it('covers every engine code', () => {
    expect(describeError({ code: 'network', message: 'x' }, 'D:\\dl').message).toBe('No network connection.');
    expect(describeError({ code: 'disk', message: 'x' }, 'D:\\dl').message).toBe('Cannot write to the destination: D:\\dl.');
    expect(describeError({ code: 'unknown', message: 'boom' }, 'D').message).toBe('boom');
  });
});

describe('downloads', () => {
  it('starts with the probed URL, preset and destination, then shows the item', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    await store.startDownload('720p');
    expect(engine.startCalls).toEqual([{ url: 'https://a.test/v', preset: '720p', destination: 'Downloads' }]);
    expect(store.state.items.map((i) => i.id)).toEqual(['t-1']);
    expect(store.state.screen).toBe('downloads');
    expect(store.state.probe).toBeNull();
  });

  it('uses getDefaultFolder as the destination', async () => {
    const { engine, store } = await setup({ getDefaultFolder: async () => 'C:\\Users\\me\\Downloads' });
    expect(store.state.settings.destination).toBe('C:\\Users\\me\\Downloads');
    await store.submitLink('https://a.test/v');
    await store.startDownload('best');
    expect(engine.startCalls[0]?.destination).toBe('C:\\Users\\me\\Downloads');
  });

  it('keeps the probe title after the engine reports done with the URL as title', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    await store.startDownload('best');
    engine.emit({ ...engine.find('t-1'), state: 'done', percent: 100, title: 'https://a.test/v', filePath: 'C:\\x\\a.mp4' });
    const first = store.state.items[0]!;
    expect(first.state).toBe('done');
    expect(first.title).toBe('Probe title');
  });

  it('formats 0.0 percent and null speed/eta without NaN', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(Number.NaN)).toBe('0%');
    expect(formatPercent(42.4)).toBe('42%');
    expect(formatSpeed(null)).toBe('—');
    expect(formatSpeed(Number.NaN)).toBe('—');
    expect(formatEta(null)).toBe('—');
    expect(formatEta(Number.NaN)).toBe('—');
    expect(formatEta(75)).toBe('1:15');
    expect(formatSpeed(1_500_000)).toBe('1.5 MB/s');
    for (const s of [formatPercent(0), formatSpeed(null), formatEta(null)]) expect(s).not.toContain('NaN');
  });

  it('a failed item shows failed; retry starts a NEW item with the same title', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    await store.startDownload('1080p');
    engine.emit({ ...engine.find('t-1'), state: 'failed', error: { code: 'network', message: 'dns' } });
    expect(store.state.items[0]?.state).toBe('failed');
    expect(store.state.error).toBeNull();
    await store.retry('t-1');
    expect(engine.startCalls).toHaveLength(2);
    expect(engine.startCalls[1]).toEqual({ url: 'https://a.test/v', preset: '1080p', destination: 'Downloads' });
    expect(store.state.items.map((i) => i.id)).toEqual(['t-1', 't-2']);
    expect(store.state.items[1]?.title).toBe('Probe title');
  });

  it('cancel moves the item to cancelled', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    await store.startDownload('best');
    await store.cancel('t-1');
    expect(engine.cancelCalls).toEqual(['t-1']);
    expect(store.state.items[0]?.state).toBe('cancelled');
  });

  it('a failed item with an outdated engine exposes the update action', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    await store.startDownload('best');
    engine.emit({ ...engine.find('t-1'), state: 'failed', error: { code: 'outdated', message: 'old' } });
    expect(store.state.error?.offerUpdate).toBe(true);
  });

  it('shows a start error (disk) with the destination path', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    engine.startError = { code: 'disk', message: 'denied' };
    await store.startDownload('best');
    expect(store.state.error?.message).toBe('Cannot write to the destination: Downloads.');
    expect(store.state.items).toHaveLength(0);
  });
});

describe('settings and subscriptions', () => {
  it('persists destination and default preset in storage', async () => {
    const storage = memStorage();
    const engine = new TestEngine();
    const store = createStore(engine, { storage, chooseFolder: async () => 'E:\\Media' });
    await store.ready;
    await store.chooseFolder();
    store.setPreset('mp3');
    expect(storage.getItem('eq.destination')).toBe('E:\\Media');
    expect(storage.getItem('eq.preset')).toBe('mp3');
    const again = createStore(engine, { storage });
    await again.ready;
    expect(again.state.settings.destination).toBe('E:\\Media');
    expect(again.state.settings.preset).toBe('mp3');
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { store } = await setup();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    await store.submitLink('hello');
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    off();
    await store.submitLink('hello again');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('races and guards', () => {
  it('a slow earlier probe cannot overwrite the No link found. state', async () => {
    const { engine, store } = await setup();
    let release!: () => void;
    engine.probeGate = new Promise<void>((r) => (release = r));
    const slow = store.submitLink('https://a.test/slow');
    await store.submitLink('hello');
    release();
    await slow;
    expect(store.state.error?.message).toBe('No link found.');
    expect(store.state.probe).toBeNull();
  });

  it('a slow earlier probe cannot overwrite a newer probe', async () => {
    const { engine, store } = await setup();
    let release!: () => void;
    engine.probeGate = new Promise<void>((r) => (release = r));
    engine.title = 'Old';
    const slow = store.submitLink('https://a.test/old');
    engine.probeGate = null;
    engine.title = 'New';
    await store.submitLink('https://a.test/new');
    release();
    await slow;
    expect(store.state.probe?.title).toBe('New');
  });

  it('two rapid startDownload calls create one item', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    let release!: () => void;
    engine.startGate = new Promise<void>((r) => (release = r));
    const a = store.startDownload('best');
    const b = store.startDownload('best');
    release();
    await Promise.all([a, b]);
    expect(engine.startCalls).toHaveLength(1);
    expect(store.state.items).toHaveLength(1);
  });

  it('asks to choose the folder again when the saved destination is rejected', async () => {
    const { engine, store } = await setup({ chooseFolder: async () => 'E:\Media' });
    await store.submitLink('https://a.test/v');
    engine.startError = { code: 'disk', message: 'That folder was not chosen in this app.' };
    await store.startDownload('best');
    expect(store.state.error?.offerChoose).toBe(true);
    expect(store.state.error?.message).toContain('Choose the folder again.');
    expect(store.state.screen).toBe('home');
    engine.startError = null;
    await store.chooseFolder();
    expect(store.state.error).toBeNull();
    expect(store.state.settings.destination).toBe('E:\Media');
    await store.startDownload('best');
    expect(engine.startCalls.at(-1)?.destination).toBe('E:\Media');
  });

  it('exposes update for items that fail as unsupported or outdated, and retry only where useful', async () => {
    const { engine, store } = await setup();
    await store.submitLink('https://a.test/v');
    await store.startDownload('best');
    engine.emit({ ...engine.find('t-1'), state: 'failed', error: { code: 'unsupported', message: 'x' } });
    expect(store.state.error?.message).toBe('This site is not supported.');
    expect(store.state.error?.offerUpdate).toBe(true);
  });
});

describe('app update', () => {
  const updater = (found: { version: string } | null, installError?: EngineError) => ({
    version: async () => '0.1.5',
    check: vi.fn(async () => found),
    install: vi.fn(async () => {
      if (installError) throw installError;
      return found?.version ?? '';
    }),
  });

  it('has no app update without an updater', async () => {
    const store = createStore(new TestEngine(), { storage: null });
    await store.ready;
    expect(store.canUpdateApp).toBe(false);
  });

  it('reads the version, checks only on request, and reports a newer one', async () => {
    const u = updater({ version: '0.1.6' });
    const store = createStore(new TestEngine(), { storage: null, appUpdater: u });
    await store.ready;
    expect(store.canUpdateApp).toBe(true);
    expect(store.state.settings.appVersion).toBe('0.1.5');
    expect(u.check).not.toHaveBeenCalled();
    await store.checkAppUpdate();
    expect(store.state.appUpdate).toEqual({ status: 'available', version: '0.1.6' });
  });

  it('says current when nothing is newer', async () => {
    const store = createStore(new TestEngine(), { storage: null, appUpdater: updater(null) });
    await store.ready;
    await store.checkAppUpdate();
    expect(store.state.appUpdate.status).toBe('current');
  });

  it('installs only after a check found an update', async () => {
    const u = updater({ version: '0.1.6' });
    const store = createStore(new TestEngine(), { storage: null, appUpdater: u });
    await store.ready;
    await store.installAppUpdate();
    expect(u.install).not.toHaveBeenCalled();
    await store.checkAppUpdate();
    await store.installAppUpdate();
    expect(u.install).toHaveBeenCalledTimes(1);
    expect(store.state.appUpdate.status).toBe('installed');
  });

  it('shows an error and stays available when the install fails', async () => {
    const store = createStore(new TestEngine(), {
      storage: null,
      appUpdater: updater({ version: '0.1.6' }, { code: 'unknown', message: 'Checksum mismatch' }),
    });
    await store.ready;
    await store.checkAppUpdate();
    await store.installAppUpdate();
    expect(store.state.appUpdate.status).toBe('available');
    expect(store.state.error?.message).toBe('Checksum mismatch');
  });

  it('returns to idle with an error when the check fails', async () => {
    const u = updater(null);
    u.check.mockRejectedValueOnce({ code: 'network', message: 'x' });
    const store = createStore(new TestEngine(), { storage: null, appUpdater: u });
    await store.ready;
    await store.checkAppUpdate();
    expect(store.state.appUpdate.status).toBe('idle');
    expect(store.state.error?.code).toBe('network');
  });
});

describe('automatic engine update', () => {
  class OutdatedEngine extends TestEngine {
    updates = 0;
    failProbes = 1;
    override async probe(url: string): Promise<ProbeResult> {
      if (this.failProbes > 0) {
        this.failProbes--;
        throw { code: 'outdated', message: 'HTTP Error 403' } satisfies EngineError;
      }
      return super.probe(url);
    }
    override async updateEngine(): Promise<string> {
      this.updates++;
      return '2026.11.01';
    }
  }

  it('updates the engine once and retries when a probe says it is out of date', async () => {
    const engine = new OutdatedEngine();
    const store = createStore(engine, { storage: null });
    await store.ready;
    await store.submitLink('https://a.test/v');
    expect(engine.updates).toBe(1);
    expect(store.state.probe?.title).toBe('Probe title');
    expect(store.state.error).toBeNull();
    expect(store.state.settings.engineVersion).toBe('2026.11.01');
  });

  it('does not update again in the same session', async () => {
    const engine = new OutdatedEngine();
    engine.failProbes = 5;
    const store = createStore(engine, { storage: null });
    await store.ready;
    await store.submitLink('https://a.test/v');
    await store.submitLink('https://a.test/w');
    expect(engine.updates).toBe(1);
    expect(store.state.error?.code).toBe('outdated');
  });
});
