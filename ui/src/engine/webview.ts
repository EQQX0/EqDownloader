import { Capacitor } from '@capacitor/core';

/**
 * True inside an Android WebView where Capacitor's bridge never came up. That happens when the WebView is too old
 * for the document-start script Capacitor injects (the fallback is an inline script the strict CSP blocks).
 * Without this check getEngine() would quietly hand back the fake engine: a working-looking app that downloads nothing.
 */
export function needsWebViewUpdate(
  nav: { userAgent: string } | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  cap: { isNativePlatform(): boolean } = Capacitor,
): boolean {
  return !!nav && /; wv\)/.test(nav.userAgent) && !cap.isNativePlatform();
}

/** Full-screen notice that replaces the app. Styled through the DOM so it needs no stylesheet. */
export function showWebViewUpdate(root: HTMLElement): void {
  const box = document.createElement('div');
  box.setAttribute('data-testid', 'webview-update');
  box.setAttribute('role', 'alert');
  Object.assign(box.style, {
    position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '2rem', textAlign: 'center', background: '#133621', color: '#f4d96c',
    font: '600 1.25rem/1.4 system-ui, sans-serif',
  });
  box.textContent = 'Update Android System WebView to use EqDownload';
  root.replaceChildren(box);
}
