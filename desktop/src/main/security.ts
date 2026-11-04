import path from 'node:path';
import type { BrowserWindowConstructorOptions, Session, WebContents } from 'electron';

/** Strict policy for the renderer. Thumbnails come from arbitrary https hosts, so img-src allows https: and data:. */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function windowOptions(preloadPath: string = path.join(__dirname, 'preload.cjs')): BrowserWindowConstructorOptions {
  return {
    width: 980,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#111111',
    title: 'EqDownload',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}

/** No new windows, no navigation away from the loaded UI. */
export function hardenWebContents(contents: Pick<WebContents, 'setWindowOpenHandler' | 'on'>): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const evt of ['will-navigate', 'will-redirect', 'will-frame-navigate'] as const) {
    contents.on(evt as 'will-navigate', (event: { preventDefault(): void }) => event.preventDefault());
  }
}

/** Deny every permission (camera, notifications, clipboard, ...). */
export function hardenSession(ses: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void {
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}
