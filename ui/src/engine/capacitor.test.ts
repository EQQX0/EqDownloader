import { describe, expect, it } from 'vitest';
import { runEngineContract } from './engine.contract';
import { CapacitorEngine, toEngineError, type EqEnginePlugin } from './capacitor';
import type { DownloadItem, EngineError } from './types';

describe('toEngineError', () => {
  it('keeps a known code and message', () => {
    expect(toEngineError({ code: 'network', message: 'offline' })).toEqual({ code: 'network', message: 'offline' });
  });
  it.each(['unsupported', 'blocked', 'network', 'outdated', 'disk', 'unknown'])('accepts %s', (code) => {
    expect(toEngineError({ code, message: 'm' }).code).toBe(code);
  });
  it('maps an unknown code to unknown', () => {
    expect(toEngineError({ code: 'EXPLODED', message: 'boom' })).toEqual({ code: 'unknown', message: 'boom' });
  });
  it('handles a missing code, an Error, a string and junk', () => {
    expect(toEngineError({ message: 'x' })).toEqual({ code: 'unknown', message: 'x' });
    expect(toEngineError(new Error('bad'))).toEqual({ code: 'unknown', message: 'bad' });
    expect(toEngineError('plain')).toEqual({ code: 'unknown', message: 'plain' });
    expect(toEngineError(null).code).toBe('unknown');
    expect(toEngineError(undefined).message.length).toBeGreaterThan(0);
  });
});

/** An in-memory EqEngine plugin that obeys the same wire contract as the Kotlin one. */
function stubPlugin(): EqEnginePlugin {
  const items = new Map<string, DownloadItem>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = { progress: new Set<(i: DownloadItem) => void>(), share: new Set<(d: { text: string }) => void>() };
  let seq = 0;
  const emit = (id: string, patch: Partial<DownloadItem>) => {
    const next = { ...items.get(id)!, ...patch };
    items.set(id, next);
    for (const l of listeners.progress) l(next);
  };
  const reject = (code: string, message: string) => Promise.reject({ code, message });
  return {
    async probe({ url }) {
      if (!/^https?:\/\//.test(url)) return reject('unsupported', 'Not a supported link');
      return { url, title: 'Stub', thumbnail: null, durationSec: 1, formats: [{ id: '1', ext: 'mp4', height: 720, abr: null, filesize: null }] };
    },
    async start({ url, preset }) {
      const id = `s-${++seq}`;
      items.set(id, { id, url, title: 'Stub', preset, state: 'queued', percent: 0, speedBps: null, etaSec: null, filePath: null, error: null });
      timers.set(id, setTimeout(() => emit(id, { state: 'running', percent: 10 }), 0));
      timers.set(id + 'd', setTimeout(() => emit(id, { state: 'done', percent: 100, filePath: 'Downloads/EqDownload/x.mp4' }), 20));
      return { id };
    },
    async cancel({ id }) {
      clearTimeout(timers.get(id + 'd'));
      const s = items.get(id)?.state;
      if (s === 'queued' || s === 'running') emit(id, { state: 'cancelled' });
    },
    async list() {
      return { items: [...items.values()] };
    },
    async updateEngine() {
      return { version: '2026.01.01' };
    },
    async addListener(event: 'progress' | 'share', cb: never) {
      const set = listeners[event] as Set<unknown>;
      set.add(cb);
      return { remove: async () => { set.delete(cb); } };
    },
  } as EqEnginePlugin;
}

runEngineContract('CapacitorEngine (stub plugin)', () => new CapacitorEngine(stubPlugin()));

describe('CapacitorEngine', () => {
  it('maps plugin rejections to EngineError', async () => {
    const plugin = { ...stubPlugin(), probe: () => Promise.reject({ code: 'weird', message: 'nope' }) } as EqEnginePlugin;
    const err = (await new CapacitorEngine(plugin).probe('https://x.test').then(() => null, (e: unknown) => e)) as EngineError;
    expect(err).toEqual({ code: 'unknown', message: 'nope' });
  });

  it('updateEngine returns the version string', async () => {
    expect(await new CapacitorEngine(stubPlugin()).updateEngine()).toBe('2026.01.01');
  });

  it('exposes the fixed Android destination and no desktop extras', async () => {
    const e = new CapacitorEngine(stubPlugin()) as unknown as Record<string, unknown>;
    expect(await (e.getDefaultFolder as () => Promise<string>)()).toBe('Downloads/EqDownload');
    expect(e.chooseFolder).toBeUndefined();
    expect(e.revealFile).toBeUndefined();
  });

  it('onShare delivers shared text and unsubscribes', async () => {
    let shareCb: ((d: { text: string }) => void) | undefined;
    let removed = false;
    const wrapped = {
      ...stubPlugin(),
      addListener: (ev: string, cb: never) => {
        if (ev === 'share') shareCb = cb;
        return Promise.resolve({ remove: async () => { removed = true; } });
      },
    } as unknown as EqEnginePlugin;
    const e = new CapacitorEngine(wrapped);
    const got: string[] = [];
    const off = e.onShare((t) => got.push(t));
    shareCb!({ text: 'look https://a.test/v' });
    expect(got).toEqual(['look https://a.test/v']);
    off();
    await Promise.resolve();
    await Promise.resolve();
    expect(removed).toBe(true);
    shareCb!({ text: 'later' }); // ignored after unsubscribe
    expect(got).toHaveLength(1);
  });
});
