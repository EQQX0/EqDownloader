import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { contentSecurityPolicy, hardenSession, hardenWebContents, windowOptions } from '../src/main/security';

describe('window security options', () => {
  const wp = windowOptions().webPreferences!;

  it('isolates the renderer', () => {
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
  });

  it('leaves webSecurity on and does not allow insecure content', () => {
    expect(wp.webSecurity).not.toBe(false);
    expect(wp.allowRunningInsecureContent).not.toBe(true);
  });

  it('loads a preload script', () => {
    expect(String(wp.preload)).toMatch(/preload\.cjs$/);
  });
});

describe('content security policy', () => {
  const csp = contentSecurityPolicy();

  it('is locked to self by default', () => {
    expect(csp).toContain("default-src 'self'");
  });

  it('has no eval', () => {
    expect(csp).not.toContain('unsafe-eval');
  });

  it('allows thumbnails from https and data', () => {
    const img = csp
      .split(';')
      .map((s) => s.trim())
      .find((d) => d.startsWith('img-src'))!;
    expect(img).toContain('https:');
    expect(img).toContain('data:');
  });

  it('forbids objects and framing', () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('hardenWebContents', () => {
  function fakeContents() {
    const ee = new EventEmitter() as EventEmitter & { setWindowOpenHandler: (h: () => { action: string }) => void };
    let handler: (() => { action: string }) | undefined;
    ee.setWindowOpenHandler = (h) => {
      handler = h;
    };
    return { ee, open: () => handler!() };
  }

  it('denies window.open', () => {
    const c = fakeContents();
    hardenWebContents(c.ee as never);
    expect(c.open()).toEqual({ action: 'deny' });
  });

  it('prevents navigation', () => {
    const c = fakeContents();
    hardenWebContents(c.ee as never);
    const preventDefault = vi.fn();
    c.ee.emit('will-navigate', { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it.each(['will-redirect', 'will-frame-navigate'])('prevents %s', (evt) => {
    const c = fakeContents();
    hardenWebContents(c.ee as never);
    const preventDefault = vi.fn();
    c.ee.emit(evt, { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });
});

describe('hardenSession', () => {
  it('denies every permission request and check', () => {
    let req: ((...a: unknown[]) => void) | undefined;
    let chk: (() => boolean) | undefined;
    hardenSession({
      setPermissionRequestHandler: (h: never) => {
        req = h;
      },
      setPermissionCheckHandler: (h: never) => {
        chk = h;
      },
    } as never);
    const cb = vi.fn();
    req!({}, 'media', cb);
    expect(cb).toHaveBeenCalledWith(false);
    expect(chk!()).toBe(false);
  });
});
