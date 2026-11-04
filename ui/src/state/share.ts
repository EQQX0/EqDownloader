import type { Engine } from '../engine/types';
import type { Screen } from './store';

/** Engines that can receive shared text (Android) implement this; others do not. */
export type ShareCapable = Engine & { onShare?(handler: (text: string) => void): () => void };

/** When the engine reports shared text, probe it and show Home. Returns an unsubscribe (a no-op without onShare). */
export function wireShare(
  engine: ShareCapable,
  store: { submitLink(text: string): Promise<void>; go(screen: Screen): void },
): () => void {
  if (typeof engine.onShare !== 'function') return () => {};
  return engine.onShare((text) => {
    store.go('home');
    void store.submitLink(text);
  });
}
