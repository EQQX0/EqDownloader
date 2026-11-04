import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from './fake';
import { getEngine, hostFor } from './getEngine';
import { CapacitorEngine } from './capacitor';
import type { Engine } from './types';

describe('getEngine / hostFor', () => {
  afterEach(() => {
    delete (globalThis as { eq?: unknown }).eq;
  });

  it('falls back to the fake engine without a bridge', () => {
    expect(getEngine()).toBeInstanceOf(FakeEngine);
  });

  it('returns window.eq when present', () => {
    const eq = new FakeEngine({ delayMs: 1 });
    (globalThis as { eq?: unknown }).eq = eq;
    expect(getEngine()).toBe(eq);
  });

  it('hostFor exposes only the extras the engine has', async () => {
    expect(hostFor(new FakeEngine())).toEqual({});
    const bridge = Object.assign(new FakeEngine(), {
      getDefaultFolder: async () => 'D',
      chooseFolder: async () => 'C',
      revealFile: async () => {},
    }) as Engine;
    const host = hostFor(bridge);
    expect(await host.getDefaultFolder?.()).toBe('D');
    expect(await host.chooseFolder?.()).toBe('C');
    expect(typeof host.revealFile).toBe('function');
  });

  it('picks CapacitorEngine on a native platform', () => {
    expect(getEngine({ isNativePlatform: () => true })).toBeInstanceOf(CapacitorEngine);
  });

  it('stays on the fake engine on a non-native platform', () => {
    expect(getEngine({ isNativePlatform: () => false })).toBeInstanceOf(FakeEngine);
  });

  it('prefers window.eq over the native check', () => {
    const eq = new FakeEngine({ delayMs: 1 });
    (globalThis as { eq?: unknown }).eq = eq;
    expect(getEngine({ isNativePlatform: () => true })).toBe(eq);
  });

  it('hostFor on CapacitorEngine hides folder choosing and reveal', () => {
    const host = hostFor(getEngine({ isNativePlatform: () => true }));
    expect(host.chooseFolder).toBeUndefined();
    expect(host.revealFile).toBeUndefined();
    expect(typeof host.getDefaultFolder).toBe('function');
  });
});
