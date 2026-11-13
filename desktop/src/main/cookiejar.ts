import fs from 'node:fs';
import path from 'node:path';
import { cookieBelongsTo, SITE_SESSION_COOKIES, siteForUrl, type Site } from '@eq/ui/engine';

/** The parts of an Electron cookie this file needs. */
export interface JarCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Seconds since the epoch. Absent for session cookies. */
  expirationDate?: number;
}

const clean = (s: string): string => s.replace(/[\t\r\n]/g, '');

/** Netscape cookie file, the format yt-dlp's --cookies reads. Session cookies get a one-year expiry so yt-dlp keeps them. */
export function toNetscape(cookies: readonly JarCookie[], site: Site, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const lines = ['# Netscape HTTP Cookie File', '# Written by EqDownload. Contains sign-in cookies: do not share.', ''];
  for (const c of cookies) {
    if (!c.domain || !cookieBelongsTo(site, c.domain)) continue;
    const domain = clean(c.domain);
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate && c.expirationDate > 0 ? Math.floor(c.expirationDate) : nowSec + 365 * 24 * 3600;
    lines.push(
      [
        `${c.httpOnly ? '#HttpOnly_' : ''}${domain}`,
        includeSub,
        clean(c.path || '/'),
        c.secure ? 'TRUE' : 'FALSE',
        String(expiry),
        clean(c.name),
        clean(c.value),
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** True when the file holds at least one cookie line. */
export function hasCookies(text: string): boolean {
  return text.split('\n').some((l) => l.trim() !== '' && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
}

/** True when the file holds a cookie that only a signed-in session has (see SITE_SESSION_COOKIES). */
export function hasSession(text: string, site: Site): boolean {
  return text.split('\n').some((l) => {
    if (l.startsWith('#') && !l.startsWith('#HttpOnly_')) return false;
    return SITE_SESSION_COOKIES[site].includes(l.split('\t')[5] ?? '');
  });
}

export class CookieJarDir {
  constructor(private readonly dir: string) {}

  fileFor(site: Site): string {
    return path.join(this.dir, `${site}.txt`);
  }

  save(site: Site, text: string): void {
    fs.mkdirSync(this.dir, { recursive: true });
    // 0o600: only this user can read it. Ignored on Windows, where the user-data folder is already per-user.
    fs.writeFileSync(this.fileFor(site), text, { mode: 0o600 });
  }

  remove(site: Site): void {
    fs.rmSync(this.fileFor(site), { force: true });
  }

  has(site: Site): boolean {
    try {
      return hasSession(fs.readFileSync(this.fileFor(site), 'utf8'), site);
    } catch {
      return false;
    }
  }

  /** The cookie file to pass to yt-dlp for this link, or undefined when the site is unknown or not signed in. */
  cookieFileFor(url: string): string | undefined {
    const site = siteForUrl(url);
    return site && this.has(site) ? this.fileFor(site) : undefined;
  }

  status(): Record<Site, boolean> {
    return { instagram: this.has('instagram'), youtube: this.has('youtube'), tiktok: this.has('tiktok') };
  }
}
