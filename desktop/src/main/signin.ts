import { BrowserWindow, session as electronSession } from 'electron';
import { SITE_LABELS, SITE_LOGIN_URLS, type Site } from '@eq/ui/engine';
import { hasCookies, toNetscape, type CookieJarDir } from './cookiejar';

/** A current desktop Chrome string. Google refuses sign-in from browsers that call themselves Electron. */
function chromeUserAgent(): string {
  const v = process.versions.chrome ?? '130.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
}

const open = new Map<Site, BrowserWindow>();

/**
 * Opens the site's real login page in its own window and its own cookie store. When the user closes the window,
 * the site's cookies are saved to a Netscape file for yt-dlp. Resolves to whether the site is now signed in.
 * The app never sees a password: the user types it into the site's own page.
 */
export function signIn(site: Site, jar: CookieJarDir, parent: BrowserWindow | null): Promise<boolean> {
  const existing = open.get(site);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return Promise.resolve(jar.has(site));
  }
  const ses = electronSession.fromPartition(`persist:login-${site}`);
  ses.setUserAgent(chromeUserAgent());
  // Only the page itself may run: no camera, location, notifications or other prompts.
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);

  const win = new BrowserWindow({
    width: 480,
    height: 760,
    title: `Sign in to ${SITE_LABELS[site]}. Close this window when you are done.`,
    autoHideMenuBar: true,
    ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  open.set(site, win);
  // Links that want a new window (Google's help pages, "Sign up") load in this one.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void win.loadURL(url);
    return { action: 'deny' };
  });

  return new Promise((resolve) => {
    let saving: Promise<void> | null = null;
    const save = (): Promise<void> =>
      (saving ??= (async () => {
        try {
          const cookies = await ses.cookies.get({});
          const text = toNetscape(cookies, site);
          // Only replace the saved file when the window held cookies for the site, so closing early keeps an earlier sign-in.
          if (hasCookies(text)) jar.save(site, text);
        } catch {
          // Keep whatever was saved before.
        }
      })());
    // Start reading the cookies as the window begins to close; the result is awaited once it has closed.
    win.on('close', () => void save());
    win.on('closed', () => {
      open.delete(site);
      void save().then(() => resolve(jar.has(site)));
    });
    void win.loadURL(SITE_LOGIN_URLS[site]).catch(() => undefined);
  });
}

export async function signOut(site: Site, jar: CookieJarDir): Promise<void> {
  jar.remove(site);
  const ses = electronSession.fromPartition(`persist:login-${site}`);
  await ses.clearStorageData().catch(() => undefined);
}
