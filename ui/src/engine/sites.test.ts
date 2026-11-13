import { describe, expect, it } from 'vitest';
import { cookieBelongsTo, isSite, siteForUrl } from './sites';

describe('siteForUrl', () => {
  it.each([
    ['https://www.tiktok.com/@u/video/7706848607252565255', 'tiktok'],
    ['https://vm.tiktok.com/ZM123/', 'tiktok'],
    ['https://www.instagram.com/reel/abc/', 'instagram'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://m.youtube.com/watch?v=abc', 'youtube'],
  ])('%s is %s', (url, site) => expect(siteForUrl(url)).toBe(site));

  it.each(['https://nottiktok.com/x', 'https://tiktok.com.evil.test/x', 'ftp://tiktok.com/x', 'not a url'])('%s is none', (url) =>
    expect(siteForUrl(url)).toBeNull(),
  );
});

describe('isSite / cookieBelongsTo', () => {
  it('accepts only the three site ids', () => {
    expect(isSite('tiktok')).toBe(true);
    expect(isSite('facebook')).toBe(false);
    expect(isSite(undefined)).toBe(false);
  });
  it('matches cookie domains with or without the leading dot, never look-alikes', () => {
    expect(cookieBelongsTo('tiktok', '.tiktok.com')).toBe(true);
    expect(cookieBelongsTo('tiktok', 'www.tiktok.com')).toBe(true);
    expect(cookieBelongsTo('tiktok', 'evil-tiktok.com')).toBe(false);
    expect(cookieBelongsTo('youtube', '.google.com')).toBe(true);
    expect(cookieBelongsTo('instagram', '.google.com')).toBe(false);
  });
});
