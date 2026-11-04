import { describe, expect, it, vi } from 'vitest';
import { FakeEngine } from '../engine/fake';
import type { Engine } from '../engine/types';
import { wireClipboard, type DocLike } from './clipboard';

function engineWith(texts: string[]): Engine {
  return Object.assign(new FakeEngine(), { readClipboard: async () => texts.shift() ?? '' }) as Engine;
}
function fakeDoc() {
  const t = new EventTarget();
  const doc = {
    addEventListener: t.addEventListener.bind(t),
    removeEventListener: t.removeEventListener.bind(t),
    visibilityState: 'visible',
    defaultView: null,
  } as unknown as DocLike;
  return { doc, show: () => t.dispatchEvent(new Event('visibilitychange')) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('wireClipboard', () => {
  it('checks a link found on the clipboard and opens Home', async () => {
    const store = { submitLink: vi.fn(async () => {}), go: vi.fn() };
    wireClipboard(engineWith(['look https://example.test/v']), store, fakeDoc().doc);
    await flush();
    expect(store.submitLink).toHaveBeenCalledWith('https://example.test/v');
    expect(store.go).toHaveBeenCalledWith('home');
  });

  it('ignores text without a link and offers the same link once', async () => {
    const store = { submitLink: vi.fn(async () => {}), go: vi.fn() };
    const d = fakeDoc();
    wireClipboard(engineWith(['hello', 'https://a.test/x', 'https://a.test/x']), store, d.doc);
    await flush();
    expect(store.submitLink).not.toHaveBeenCalled();
    d.show();
    await flush();
    d.show();
    await flush();
    expect(store.submitLink).toHaveBeenCalledTimes(1);
  });

  it('does nothing without readClipboard', () => {
    const store = { submitLink: vi.fn(async () => {}), go: vi.fn() };
    expect(() => wireClipboard(new FakeEngine(), store, fakeDoc().doc)).not.toThrow();
    expect(store.go).not.toHaveBeenCalled();
  });
});
