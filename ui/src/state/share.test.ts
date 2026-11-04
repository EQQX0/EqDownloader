import { describe, expect, it, vi } from 'vitest';
import { FakeEngine } from '../engine/fake';
import type { Engine } from '../engine/types';
import { wireShare } from './share';

function shareEngine() {
  let handler: ((t: string) => void) | null = null;
  const engine = Object.assign(new FakeEngine(), {
    onShare(h: (t: string) => void) {
      handler = h;
      return () => {
        handler = null;
      };
    },
  }) as Engine;
  return { engine, fire: (t: string) => handler?.(t), active: () => handler !== null };
}

describe('wireShare', () => {
  it('submits shared text and opens Home', () => {
    const { engine, fire } = shareEngine();
    const store = { submitLink: vi.fn(async () => {}), go: vi.fn() };
    wireShare(engine, store);
    fire('Watch this https://example.test/v please');
    expect(store.submitLink).toHaveBeenCalledWith('Watch this https://example.test/v please');
    expect(store.go).toHaveBeenCalledWith('home');
  });

  it('does nothing when the engine has no onShare', () => {
    const store = { submitLink: vi.fn(async () => {}), go: vi.fn() };
    expect(() => wireShare(new FakeEngine(), store)).not.toThrow();
    expect(store.go).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe', () => {
    const { engine, active } = shareEngine();
    const off = wireShare(engine, { submitLink: async () => {}, go: () => {} });
    expect(active()).toBe(true);
    off();
    expect(active()).toBe(false);
  });
});
