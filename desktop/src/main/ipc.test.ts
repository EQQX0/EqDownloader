import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineErrorCode } from '@eq/ui/engine';
import { checkDestination, isUnderAny, toEnvelope, unwrapEnvelope } from './ipc';

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
