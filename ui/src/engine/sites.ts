/** Sites the app can sign in to, so yt-dlp can use the account's cookies. */
export type Site = 'instagram' | 'youtube' | 'tiktok';

export const SITES: readonly Site[] = ['instagram', 'youtube', 'tiktok'];

export const SITE_LABELS: Record<Site, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

/** Where the sign-in window opens. Fixed in the app: the page never chooses it. */
export const SITE_LOGIN_URLS: Record<Site, string> = {
  instagram: 'https://www.instagram.com/accounts/login/',
  youtube: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
  tiktok: 'https://www.tiktok.com/login',
};

/** Cookie domains saved for each site (a cookie matches when its domain is, or ends with, one of these). */
export const SITE_COOKIE_DOMAINS: Record<Site, readonly string[]> = {
  instagram: ['instagram.com'],
  youtube: ['youtube.com', 'google.com'],
  tiktok: ['tiktok.com'],
};

/** Cookies that exist only after a real sign-in. A visitor's cookies (ttwid, msToken) do not count. */
export const SITE_SESSION_COOKIES: Record<Site, readonly string[]> = {
  instagram: ['sessionid'],
  youtube: ['SAPISID', '__Secure-3PSID', 'LOGIN_INFO'],
  tiktok: ['sessionid'],
};

const HOSTS: ReadonlyArray<readonly [Site, readonly string[]]> = [
  ['instagram', ['instagram.com']],
  ['youtube', ['youtube.com', 'youtu.be', 'youtube-nocookie.com']],
  ['tiktok', ['tiktok.com']],
];

/** The signed-in site a link belongs to, or null. Matches the host and its subdomains (vm.tiktok.com, m.youtube.com). */
export function siteForUrl(url: string): Site | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [site, domains] of HOSTS) {
    if (domains.some((d) => host === d || host.endsWith(`.${d}`))) return site;
  }
  return null;
}

export function isSite(v: unknown): v is Site {
  return typeof v === 'string' && (SITES as readonly string[]).includes(v);
}

/** Whether a cookie's domain (".tiktok.com" or "www.tiktok.com") belongs to the site. */
export function cookieBelongsTo(site: Site, cookieDomain: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase();
  return SITE_COOKIE_DOMAINS[site].some((s) => d === s || d.endsWith(`.${s}`));
}
