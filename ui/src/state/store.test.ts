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

  async probe(url: string): Promise<ProbeResult> {
    this.probeCalls.push(url);
    if (this.probeError) throw this.probeError;
    return { url, title: this.title, thumbnail: null, durationSec: 10, formats: [] };
  }
  async start(url: string, preset: Preset, destination: string): Promise<string> {
    this.startCalls.push({ url, preset, destination });
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
