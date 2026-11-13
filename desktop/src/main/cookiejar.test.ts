import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CookieJarDir, hasCookies, toNetscape } from './cookiejar';

const NOW = 1_700_000_000;

describe('toNetscape', () => {
  it('writes tab-separated lines with the HttpOnly prefix and keeps only the site\'s cookies', () => {
    const text = toNetscape(
      [
        { name: 'sessionid', value: 'abc', domain: '.tiktok.com', path: '/', secure: true, httpOnly: true, expirationDate: 1_800_000_000.5 },
        { name: 'tt_chain', value: 'x', domain: 'www.tiktok.com', path: '/a', secure: false },
        { name: 'other', value: 'no', domain: '.example.com', path: '/' },
      ],
      'tiktok',
      NOW,
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Netscape HTTP Cookie File');
    expect(lines).toContain('#HttpOnly_.tiktok.com\tTRUE\t/\tTRUE\t1800000000\tsessionid\tabc');
    // A session cookie (no expiry) gets a year so yt-dlp does not drop it.
    expect(lines).toContain(`www.tiktok.com\tFALSE\t/a\tFALSE\t${NOW + 365 * 24 * 3600}\ttt_chain\tx`);
    expect(text).not.toContain('example.com');
  });

  it('strips tabs and newlines from values so a cookie cannot add lines', () => {
    const text = toNetscape([{ name: 'a', value: 'x\ty\nz', domain: '.instagram.com' }], 'instagram', NOW);
    expect(text.split('\n').filter((l) => l.includes('instagram.com'))).toHaveLength(1);
    expect(text).toContain('\txyz\n');
  });

  it('YouTube keeps google.com sign-in cookies', () => {
    const text = toNetscape([{ name: 'SID', value: '1', domain: '.google.com' }, { name: 'VISITOR', value: '2', domain: '.youtube.com' }], 'youtube', NOW);
    expect(text).toContain('.google.com');
    expect(text).toContain('.youtube.com');
  });
});

describe('hasCookies', () => {
  it('is false for a header-only file and true once a cookie line exists', () => {
    expect(hasCookies(toNetscape([], 'tiktok', NOW))).toBe(false);
    expect(hasCookies(toNetscape([{ name: 'a', value: 'b', domain: '.tiktok.com', httpOnly: true }], 'tiktok', NOW))).toBe(true);
  });
});

describe('CookieJarDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-jar-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns a cookie file only for a signed-in site that matches the link', () => {
    const jar = new CookieJarDir(path.join(dir, 'cookies'));
    expect(jar.cookieFileFor('https://vm.tiktok.com/abc')).toBeUndefined();
    jar.save('tiktok', toNetscape([{ name: 'sessionid', value: 'v', domain: '.tiktok.com' }], 'tiktok', NOW));
    expect(jar.cookieFileFor('https://vm.tiktok.com/abc')).toBe(jar.fileFor('tiktok'));
    expect(jar.cookieFileFor('https://www.instagram.com/p/1')).toBeUndefined();
    expect(jar.cookieFileFor('https://nottiktok.com/x')).toBeUndefined();
    expect(jar.status()).toEqual({ instagram: false, youtube: false, tiktok: true });
  });

  it('remove signs the site out', () => {
    const jar = new CookieJarDir(path.join(dir, 'cookies'));
    jar.save('youtube', toNetscape([{ name: 'SID', value: '1', domain: '.youtube.com' }], 'youtube', NOW));
    jar.remove('youtube');
    expect(jar.has('youtube')).toBe(false);
  });
});
