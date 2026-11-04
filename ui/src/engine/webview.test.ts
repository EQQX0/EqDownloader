import { describe, expect, it } from 'vitest';
import { needsWebViewUpdate } from './webview';

const WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 10; Pixel 3 Build/QQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/90.0.0.0 Mobile Safari/537.36';
const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

describe('needsWebViewUpdate', () => {
  it('is true for an Android WebView where Capacitor did not come up', () => {
    expect(needsWebViewUpdate({ userAgent: WEBVIEW_UA }, { isNativePlatform: () => false })).toBe(true);
  });
  it('is false for an Android WebView that has Capacitor', () => {
    expect(needsWebViewUpdate({ userAgent: WEBVIEW_UA }, { isNativePlatform: () => true })).toBe(false);
  });
  it('is false in a normal browser, desktop or mobile', () => {
    expect(needsWebViewUpdate({ userAgent: CHROME_UA }, { isNativePlatform: () => false })).toBe(false);
    expect(needsWebViewUpdate({ userAgent: DESKTOP_UA }, { isNativePlatform: () => false })).toBe(false);
  });
  it('is false without a navigator', () => {
    expect(needsWebViewUpdate(undefined, { isNativePlatform: () => false })).toBe(false);
  });
});
