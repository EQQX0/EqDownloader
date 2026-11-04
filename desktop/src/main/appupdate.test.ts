import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAppUpdate, cmdSafe, installAppUpdate, isNewer, parseVersion, swapScript } from './appupdate';

const EXE = Buffer.from('new exe bytes');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function fakeFetch(opts: { tag?: string; sums?: string; exe?: Buffer; assets?: string[] } = {}): typeof fetch {
  const tag = opts.tag ?? 'v0.1.6';
  const names = opts.assets ?? ['EqDownload.exe', 'EqDownload.apk', 'SHA256SUMS.txt'];
  const base = `https://github.com/EQQX0/EqDownloader/releases/download/${tag}/`;
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/releases/latest')) {
      return new Response(JSON.stringify({ tag_name: tag, assets: names.map((n) => ({ name: n, browser_download_url: base + n })) }), { status: 200 });
    }
    if (url === base + 'SHA256SUMS.txt') return new Response(opts.sums ?? `${sha(opts.exe ?? EXE)}  EqDownload.exe\n`, { status: 200 });
    if (url === base + 'EqDownload.exe') return new Response(opts.exe ?? EXE, { status: 200 });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
}

describe('version compare', () => {
  it('orders plain versions', () => {
    expect(isNewer('v0.1.6', '0.1.5')).toBe(true);
    expect(isNewer('v0.1.5', '0.1.5')).toBe(false);
    expect(isNewer('v0.1.4', '0.1.5')).toBe(false);
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true);
  });
  it('ignores anything that is not x.y.z', () => {
    expect(parseVersion('latest')).toBeNull();
    expect(isNewer('v0.1.6-beta', '0.1.5')).toBe(false);
  });
});

describe('checkAppUpdate', () => {
  it('returns the newer version', async () => {
    expect(await checkAppUpdate('0.1.5', fakeFetch())).toEqual({ version: '0.1.6' });
  });
  it('returns null when current', async () => {
    expect(await checkAppUpdate('0.1.6', fakeFetch())).toBeNull();
  });
  it('fails when the release has no exe yet', async () => {
    await expect(checkAppUpdate('0.1.5', fakeFetch({ assets: ['EqDownload.apk'] }))).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('installAppUpdate', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-upd-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const target = () => path.join(dir, 'EqDownload.exe');

  it('stages a verified exe and starts the swap script', async () => {
    const launch = vi.fn();
    const v = await installAppUpdate({ current: '0.1.5', target: target(), tmpDir: dir, fetch: fakeFetch(), launch });
    expect(v).toBe('0.1.6');
    expect(launch).toHaveBeenCalledTimes(1);
    const script = fs.readFileSync(launch.mock.calls[0]![0] as string, 'utf8');
    expect(script).toContain(`move /y "${path.join(dir, '.EqDownload.v0.1.6.new')}" "${target()}"`);
    expect(fs.readFileSync(path.join(dir, '.EqDownload.v0.1.6.new'))).toEqual(EXE);
  });

  it('refuses a checksum mismatch and stages nothing', async () => {
    const launch = vi.fn();
    await expect(
      installAppUpdate({ current: '0.1.5', target: target(), tmpDir: dir, fetch: fakeFetch({ sums: `${'0'.repeat(64)}  EqDownload.exe\n` }), launch }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Checksum mismatch') });
    expect(launch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, '.EqDownload.v0.1.6.new'))).toBe(false);
  });

  it('refuses when there is no checksum file', async () => {
    await expect(
      installAppUpdate({ current: '0.1.5', target: target(), tmpDir: dir, fetch: fakeFetch({ assets: ['EqDownload.exe'] }), launch: vi.fn() }),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it('refuses when already current', async () => {
    await expect(
      installAppUpdate({ current: '0.1.6', target: target(), tmpDir: dir, fetch: fakeFetch(), launch: vi.fn() }),
    ).rejects.toMatchObject({ message: expect.stringContaining('newest') });
  });

  it('only works from the portable exe', async () => {
    await expect(installAppUpdate({ current: '0.1.5', target: undefined, tmpDir: dir, fetch: fakeFetch(), launch: vi.fn() })).rejects.toMatchObject({ code: 'unknown' });
  });

  it('refuses paths with characters cmd.exe treats specially', async () => {
    await expect(
      installAppUpdate({ current: '0.1.5', target: path.join(dir, 'a&b.exe'), tmpDir: dir, fetch: fakeFetch(), launch: vi.fn() }),
    ).rejects.toMatchObject({ message: expect.stringContaining('special characters') });
  });
});

describe('cmdSafe and swapScript', () => {
  it('flags dangerous characters', () => {
    expect(cmdSafe('C:\\Users\\Me\\EqDownload.exe')).toBe(true);
    for (const bad of ['a&b', 'a%b', 'a^b', 'a"b', 'a|b', 'a<b', 'a!b']) expect(cmdSafe(bad)).toBe(false);
  });
  it('retries the move, then starts the new exe', () => {
    const s = swapScript('C:\\n.new', 'C:\\EqDownload.exe');
    expect(s).toContain('move /y "C:\\n.new" "C:\\EqDownload.exe"');
    expect(s).toContain('start "" "C:\\EqDownload.exe"');
    expect(s).toContain('lss 60');
  });
});
