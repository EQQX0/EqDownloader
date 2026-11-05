import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineErrorCode } from '@eq/ui/engine';
import { checkDestination, isTrustedSender, isUnderAny, mergeFolders, parseAllowedFolders, serializeAllowedFolders, toEnvelope, unwrapEnvelope } from './ipc';

const codes: EngineErrorCode[] = ['unsupported', 'blocked', 'network', 'outdated', 'disk', 'unknown'];

async function catchSync(fn: () => unknown): Promise<unknown> {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('result envelope', () => {
  it('wraps and unwraps a value', async () => {
    const env = await toEnvelope(async () => 42);
    expect(env).toEqual({ ok: true, value: 42 });
    expect(unwrapEnvelope(env)).toBe(42);
  });

  it.each(codes)('round-trips EngineError %s as a plain object', async (code) => {
    const env = await toEnvelope(async () => {
      throw { code, message: `m-${code}` };
    });
    expect(env).toEqual({ ok: false, error: { code, message: `m-${code}` } });
    const caught = await catchSync(() => unwrapEnvelope(env));
    expect(caught).toEqual({ code, message: `m-${code}` });
    expect(caught).not.toBeInstanceOf(Error);
  });

  it('maps unexpected errors to code unknown', async () => {
    const env = await toEnvelope(async () => {
      throw new Error('boom');
    });
    expect(env).toEqual({ ok: false, error: { code: 'unknown', message: 'boom' } });
    const str = await toEnvelope(async () => {
      throw 'plain';
    });
    expect(str).toEqual({ ok: false, error: { code: 'unknown', message: 'plain' } });
  });

  it('maps an unrecognised code to unknown', async () => {
    const env = await toEnvelope(async () => {
      throw { code: 'weird', message: 'hi' };
    });
    expect(env).toEqual({ ok: false, error: { code: 'unknown', message: 'hi' } });
  });
});

describe('destination checks', () => {
  const allowed = [path.resolve('C:/Users/me/Downloads'), path.resolve('D:/Videos')];

  it('accepts only remembered folders', () => {
    expect(checkDestination(allowed[0], allowed)).toBe(allowed[0]);
    expect(() => checkDestination(allowed[1]! + path.sep, allowed)).not.toThrow();
  });

  it('rejects anything else with code disk', async () => {
    for (const d of ['C:/Windows', 'relative', path.join(allowed[0]!, 'sub'), '', 5]) {
      expect(await catchSync(() => checkDestination(d, allowed))).toMatchObject({ code: 'disk' });
    }
  });

  it('isUnderAny checks containment without prefix tricks', () => {
    expect(isUnderAny(path.join(allowed[0]!, 'a', 'b.mp4'), allowed)).toBe(true);
    expect(isUnderAny(allowed[0] + '-evil' + path.sep + 'a.mp4', allowed)).toBe(false);
    expect(isUnderAny(path.join(allowed[0]!, '..', 'x.mp4'), allowed)).toBe(false);
    expect(isUnderAny(allowed[0], allowed)).toBe(false);
    expect(isUnderAny('relative/a.mp4', allowed)).toBe(false);
  });
});

describe('persisted allowed folders', () => {
  const abs = (p: string) => path.resolve(p);
  const dirs = new Set([abs('/media/a'), abs('/media/b')]);
  const isDir = (p: string) => dirs.has(p);

  it('round-trips through serialize and parse', () => {
    const raw = serializeAllowedFolders([abs('/media/a'), abs('/media/b')]);
    expect(parseAllowedFolders(raw, isDir)).toEqual([abs('/media/a'), abs('/media/b')]);
  });

  it('ignores missing, empty and malformed files', () => {
    expect(parseAllowedFolders(null, isDir)).toEqual([]);
    expect(parseAllowedFolders('', isDir)).toEqual([]);
    expect(parseAllowedFolders('{not json', isDir)).toEqual([]);
    expect(parseAllowedFolders('"text"', isDir)).toEqual([]);
    expect(parseAllowedFolders('{"folders":"x"}', isDir)).toEqual([]);
  });

  it('drops non-absolute, non-string and missing-directory entries', () => {
    const raw = JSON.stringify({ folders: ['relative/dir', 42, null, abs('/media/gone'), abs('/media/a')] });
    expect(parseAllowedFolders(raw, isDir)).toEqual([abs('/media/a')]);
  });

  it('treats a throwing existence check as not a directory', () => {
    const raw = JSON.stringify({ folders: [abs('/media/a')] });
    expect(parseAllowedFolders(raw, () => { throw new Error('EACCES'); })).toEqual([]);
  });

  it('de-duplicates, case-insensitively on win32', () => {
    const merged = mergeFolders([abs('/media/a')], [abs('/media/a'), abs('/media/b')]);
    expect(merged).toEqual([abs('/media/a'), abs('/media/b')]);
    if (process.platform === 'win32') {
      expect(mergeFolders(['C:\\Media\\A'], ['c:\\media\\a\\'])).toEqual(['C:\\Media\\A']);
    }
  });
});

describe('isTrustedSender', () => {
  const app = 'file:///C:/app/ui/index.html';
  it('accepts the app page, with or without a hash', () => {
    expect(isTrustedSender(app, app)).toBe(true);
    expect(isTrustedSender(`${app}#/settings`, app)).toBe(true);
  });
  it('rejects other pages, missing urls and look-alikes', () => {
    expect(isTrustedSender(undefined, app)).toBe(false);
    expect(isTrustedSender('', app)).toBe(false);
    expect(isTrustedSender('https://evil.example/', app)).toBe(false);
    expect(isTrustedSender('file:///C:/other/index.html', app)).toBe(false);
    expect(isTrustedSender(`${app}.evil.html`, app)).toBe(false);
  });
  it('accepts the dev server origin only when given', () => {
    expect(isTrustedSender('http://localhost:5173/x', app, 'http://localhost:5173')).toBe(true);
    expect(isTrustedSender('http://localhost:5173/x', app)).toBe(false);
    expect(isTrustedSender('http://localhost:51730/x', app, 'http://localhost:5173')).toBe(false);
  });
});

describe('isTrustedSender encoding tolerance', () => {
  it('matches the same file despite escaped spaces and drive-letter case', () => {
    const app = 'file:///C:/Users/Some%20One/AppData/Local/Temp/x/resources/ui/index.html';
    expect(isTrustedSender('file:///c:/Users/Some One/AppData/Local/Temp/x/resources/ui/index.html#a', app)).toBe(true);
    expect(isTrustedSender('file:///C:/Users/Other/index.html', app)).toBe(false);
    expect(isTrustedSender('https://evil.test/Users/Some%20One/AppData/Local/Temp/x/resources/ui/index.html', app)).toBe(false);
  });
});
