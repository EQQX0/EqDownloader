import { extractUrl } from '../lib/url';
import type { Engine } from '../engine/types';
import type { Screen } from './store';

/** Engines that can read the clipboard (Android) implement this; others do not. */
export type ClipboardCapable = Engine & { readClipboard?(): Promise<string> };

/** The slice of Document this needs, so tests can pass a stand-in. */
export type DocLike = Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState' | 'defaultView'>;

interface Target {
  submitLink(text: string): Promise<void>;
  go(screen: Screen): void;
}

/**
 * When the app opens or comes back to the front and the clipboard holds a link, open Home and check it.
 * Each distinct link is offered once, so clearing the result does not bring it back. Returns an unsubscribe.
 */
export function wireClipboard(engine: ClipboardCapable, store: Target, doc: DocLike = document): () => void {
  if (typeof engine.readClipboard !== 'function') return () => {};
  const read = engine.readClipboard.bind(engine);
  let last: string | null = null;
  let busy = false;
  const look = async (): Promise<void> => {
    if (busy || doc.visibilityState === 'hidden') return;
    busy = true;
    try {
      const url = extractUrl(await read());
      if (!url || url === last) return;
      last = url;
      store.go('home');
      void store.submitLink(url);
    } finally {
      busy = false;
    }
  };
  const onShown = (): void => void look();
  const win = doc.defaultView;
  doc.addEventListener('visibilitychange', onShown);
  win?.addEventListener('focus', onShown);
  void look();
  return () => {
    doc.removeEventListener('visibilitychange', onShown);
    win?.removeEventListener('focus', onShown);
  };
}
