import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAllowedUrl, parseChecksums, sha256Hex, updateYtDlp, verifyChecksum } from './update';

const hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describe('parseChecksums', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);

  it('parses sha256sum format, including binary-mode asterisk', () => {
    const m = parseChecksums(`${a}  yt-dlp.exe\n${b} *yt-dlp\n\n`);
    expect(m.get('yt-dlp.exe')).toBe(a);
    expect(m.get('yt-dlp')).toBe(b);
  });

  it('lowercases digests and ignores malformed lines', () => {
    const m = parseChecksums(`${a.toUpperCase()}  x.exe\nnot a checksum line\n${'c'.repeat(10)}  short\n`);
    expect(m.get('x.exe')).toBe(a);
    expect(m.size).toBe(1);
  });
});

describe('verifyChecksum', () => {
  const data = Buffer.from('hello');
  const sums = parseChecksums(`${hex(data)}  yt-dlp.exe\n`);

  it('accepts a matching digest', () => {
    expect(() => verifyChecksum(data, 'yt-dlp.exe', sums)).not.toThrow();
  });

  it('rejects a mismatch', () => {
    expect(() => verifyChecksum(Buffer.from('tampered'), 'yt-dlp.exe', sums)).toThrow(/checksum/i);
  });

  it('rejects when the file is not listed', () => {
    expect(() => verifyChecksum(data, 'other.exe', sums)).toThrow(/no checksum/i);
  });

  it('sha256Hex matches node crypto', () => {
    expect(sha256Hex(data)).toBe(hex(data));
  });
});

describe('assertAllowedUrl', () => {
  it('allows only the three GitHub hosts over https', () => {
    for (const u of [
      'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
      'https://github.com/yt-dlp/yt-dlp/releases/download/x/yt-dlp.exe',
      'https://objects.githubusercontent.com/abc',
    ]) {
      expect(() => assertAllowedUrl(u)).not.toThrow();
    }
    for (const u of ['http://github.com/x', 'https://evil.example/x', 'https://github.com.evil.example/x', 'not a url']) {
      expect(() => assertAllowedUrl(u)).toThrow();
    }
  });
});

describe('updateYtDlp', () => {
  const exe = Buffer.from('MZ-new-ytdlp');
  const release = {
    tag_name: '2099.01.01',
    assets: [
      { name: 'yt-dlp.exe', browser_download_url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2099.01.01/yt-dlp.exe' },
      { name: 'SHA2-256SUMS', browser_download_url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2099.01.01/SHA2-256SUMS' },
    ],
  };

  function makeFetch(sumsBody: string, calls: string[] = []) {
    return (async (url: string) => {
      calls.push(url);
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (url.endsWith('/releases/latest')) return json(release);
      if (url.endsWith('SHA2-256SUMS')) return new Response(sumsBody, { status: 200 });
      if (url.endsWith('yt-dlp.exe')) return new Response(exe, { status: 200 });
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
  }

  async function tmp() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'eq-upd-'));
  }

  it('downloads, verifies and installs into the user data dir', async () => {
    const dir = await tmp();
    const calls: string[] = [];
    const v = await updateYtDlp({ userDataDir: dir, fetch: makeFetch(`${hex(exe)}  yt-dlp.exe\n`, calls) });
    expect(v).toBe('2099.01.01');
    expect(await fs.readFile(path.join(dir, 'yt-dlp.exe'))).toEqual(exe);
    expect(calls[0]).toBe('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
    expect((await fs.readdir(dir)).sort()).toEqual(['yt-dlp.exe']);
  });

  it('refuses a binary that fails verification and leaves any existing copy untouched', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'yt-dlp.exe'), 'old');
    await expect(
      updateYtDlp({ userDataDir: dir, fetch: makeFetch(`${'0'.repeat(64)}  yt-dlp.exe\n`) }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(await fs.readFile(path.join(dir, 'yt-dlp.exe'), 'utf8')).toBe('old');
    expect(await fs.readdir(dir)).toEqual(['yt-dlp.exe']);
  });

  it('refuses a download URL outside the allowed hosts', async () => {
    const dir = await tmp();
    const bad = {
      ...release,
      assets: [{ ...release.assets[0]!, browser_download_url: 'https://evil.example/yt-dlp.exe' }, release.assets[1]!],
    };
    const f = (async (url: string) =>
      url.endsWith('/releases/latest') ? new Response(JSON.stringify(bad), { status: 200 }) : new Response('x')) as unknown as typeof fetch;
    await expect(updateYtDlp({ userDataDir: dir, fetch: f })).rejects.toBeTruthy();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('fails when the release has no checksum asset', async () => {
    const dir = await tmp();
    const noSums = { ...release, assets: [release.assets[0]!] };
    const f = (async () => new Response(JSON.stringify(noSums), { status: 200 })) as unknown as typeof fetch;
    await expect(updateYtDlp({ userDataDir: dir, fetch: f })).rejects.toMatchObject({ code: 'network' });
  });
});
