import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DownloadItem, EngineError } from '@eq/ui/engine';
import { runEngineContract } from '@eq/ui/engine/contract';
import { buildArgs, mapStderr, parseProgressLine, YtDlpEngine } from './ytdlp';

const FAKE = fileURLToPath(new URL('../../test/fake-ytdlp.mjs', import.meta.url));

function makeEngine(extra: Partial<ConstructorParameters<typeof YtDlpEngine>[0]> = {}): YtDlpEngine {
  return new YtDlpEngine({
    ytdlpPath: process.execPath,
    ytdlpArgsPrefix: [FAKE],
    ffmpegPath: 'ffmpeg-not-used',
    ...extra,
  });
}

runEngineContract('YtDlpEngine (fake yt-dlp)', () => makeEngine());

function waitFor(e: YtDlpEngine, pred: (i: DownloadItem) => boolean): Promise<DownloadItem> {
  return new Promise((resolve) => {
    const off = e.onProgress((i) => {
      if (pred(i)) {
        off();
        resolve(i);
      }
    });
  });
}

describe('parseProgressLine', () => {
  it('parses percent, speed and eta', () => {
    expect(parseProgressLine('download: 45.2%|1234567|12')).toEqual({ percent: 45.2, speedBps: 1234567, etaSec: 12 });
  });

  it('turns NA and None into null, never NaN', () => {
    expect(parseProgressLine('download:  1.0%|NA|NA')).toEqual({ percent: 1, speedBps: null, etaSec: null });
    expect(parseProgressLine('download:100.0%|None|None')).toEqual({ percent: 100, speedBps: null, etaSec: null });
  });

  it('accepts float speed and eta', () => {
    expect(parseProgressLine('download: 10.0%|1500.5|3.0')).toEqual({ percent: 10, speedBps: 1500.5, etaSec: 3 });
  });

  it('parses the bare form real yt-dlp prints (no download: prefix)', () => {
    expect(parseProgressLine(' 17.4%|220664416.67|0')).toEqual({ percent: 17.4, speedBps: 220664416.67, etaSec: 0 });
    expect(parseProgressLine('  0.0%|NA|NA')).toEqual({ percent: 0, speedBps: null, etaSec: null });
    expect(parseProgressLine('100.0%|None|None')).toEqual({ percent: 100, speedBps: null, etaSec: null });
  });

  it('returns null for non-progress and garbage lines', () => {
    expect(parseProgressLine('[youtube] extracting')).toBeNull();
    expect(parseProgressLine('download:NA|NA|NA')).toBeNull();
    expect(parseProgressLine('download:abc%|1|2')).toBeNull();
    expect(parseProgressLine('')).toBeNull();
  });

  it('turns unparseable speed or eta into null', () => {
    expect(parseProgressLine('download: 5.0%|garbage|')).toEqual({ percent: 5, speedBps: null, etaSec: null });
  });
});

describe('buildArgs', () => {
  it('includes the required flags and output template', () => {
    const a = buildArgs('https://x.test/v', 'best', 'C:\\dl');
    expect(a.slice(0, 2)).toEqual(['--ignore-config', '--no-plugin-dirs']);
    expect(a).toContain('--newline');
    expect(a).toContain('--windows-filenames');
    expect(a[a.indexOf('--progress-template') + 1]).toBe(
      'download:%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s',
    );
    expect(a[a.indexOf('-o') + 1]).toBe('%(title).120B [%(id)s].%(ext)s');
    expect(a[a.indexOf('-P') + 1]).toBe('C:\\dl');
    expect(a).not.toContain('-x');
    expect(a[a.length - 1]).toBe('https://x.test/v');
  });

  it('adds audio extraction for audio presets', () => {
    const a = buildArgs('https://x.test/v', 'mp3', 'C:\\dl');
    expect(a).toContain('-x');
    expect(a[a.indexOf('--audio-format') + 1]).toBe('mp3');
    const b = buildArgs('https://x.test/v', 'm4a', 'C:\\dl');
    expect(b[b.indexOf('--audio-format') + 1]).toBe('m4a');
  });

  it('uses the preset format selector', () => {
    const a = buildArgs('https://x.test/v', '720p', 'C:\\dl');
    expect(a[a.indexOf('-f') + 1]).toBe('bv*[height<=720][format_note!*=?watermark]+ba/b[height<=720][format_note!*=?watermark]');
  });
});

describe('mapStderr', () => {
  const cases: Array<[string, string]> = [
    ['ERROR: Unsupported URL: x', 'unsupported'],
    ['ERROR: Sign in to confirm you are not a bot', 'blocked'],
    ['ERROR: This video may be inappropriate for some users. Confirm your age', 'blocked'],
    ['This video is not available in your country', 'blocked'],
    ['ERROR: Unable to download webpage: boom', 'network'],
    ['ERROR: HTTP Error 403: Forbidden', 'outdated'],
    ['WARNING: nsig extraction failed', 'outdated'],
    ['OSError: [Errno 28] No space left on device', 'disk'],
    ["PermissionError: [Errno 13] Permission denied: 'C:\dl'", 'disk'],
    ['ERROR: something else', 'unknown'],
    ['ERROR: a message was generated', 'unknown'],
  ];
  for (const [text, code] of cases) {
    it(`${JSON.stringify(text)} -> ${code}`, () => {
      expect(mapStderr(text)).toBe(code);
    });
  }
});

describe('YtDlpEngine behaviour', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqdl-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const listParts = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((x) =>
        x.isDirectory() ? listParts(path.join(d, x.name)) : x.name.endsWith('.part') ? [x.name] : [],
      );

  it('probe maps -J json to ProbeResult', async () => {
    const r = await makeEngine().probe('https://example.test/v?title=Hello');
    expect(r.title).toBe('Hello');
    expect(r.durationSec).toBe(120);
    expect(r.thumbnail).toBe('https://example.test/t.jpg');
    expect(r.formats[0]).toEqual({ id: '137', ext: 'mp4', height: 1080, abr: null, filesize: 50000000 });
    expect(r.formats[1]!.filesize).toBe(2000000);
  });

  it('probe maps yt-dlp stderr to an error code', async () => {
    const err = (await makeEngine()
      .probe('https://example.test/v?fail=unsupported')
      .then(() => null, (e: unknown) => e)) as EngineError;
    expect(err.code).toBe('unsupported');
  });

  it('a failing download ends failed with a mapped code', async () => {
    const e = makeEngine();
    const p = waitFor(e, (i) => i.state === 'failed');
    await e.start('https://example.test/v?fail=disk', 'best', dir);
    const item = await p;
    expect(item.error?.code).toBe('disk');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a successful download reaches done at 100 with an existing file in the destination', async () => {
    const e = makeEngine();
    const p = waitFor(e, (i) => i.state === 'done');
    await e.start('https://example.test/v', 'best', dir);
    const item = await p;
    expect(item.percent).toBe(100);
    expect(item.filePath).not.toBeNull();
    expect(path.dirname(item.filePath!)).toBe(dir);
    expect(fs.existsSync(item.filePath!)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([path.basename(item.filePath!)]);
  });

  it('progress values are null rather than NaN when yt-dlp reports NA', async () => {
    const e = makeEngine();
    const seen: DownloadItem[] = [];
    e.onProgress((i) => seen.push(i));
    const p = waitFor(e, (i) => i.state === 'done');
    await e.start('https://example.test/v', 'best', dir);
    await p;
    for (const i of seen) {
      for (const n of [i.percent, i.speedBps, i.etaSec]) {
        if (n !== null) expect(Number.isNaN(n)).toBe(false);
      }
    }
    expect(seen.some((i) => i.state === 'running' && i.speedBps === null)).toBe(true);
  });

  it('cancel kills the process, removes *.part files, ends cancelled', async () => {
    const e = makeEngine();
    const running = waitFor(e, (i) => i.state === 'running');
    const id = await e.start('https://example.test/v?hang=1', 'best', dir);
    await running;
    expect(listParts(dir)).toHaveLength(1);
    const pid = e.pidOf(id);
    expect(pid).toBeGreaterThan(0);
    await e.cancel(id);
    expect((await e.list()).find((i) => i.id === id)?.state).toBe('cancelled');
    expect(listParts(dir)).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(() => process.kill(pid!, 0)).toThrow();
  });

  it('two simultaneous starts of the same URL produce different file paths', async () => {
    const e = makeEngine();
    const done: DownloadItem[] = [];
    const both = new Promise<void>((resolve) => {
      e.onProgress((i) => {
        if (i.state === 'done') {
          done.push(i);
          if (done.length === 2) resolve();
        }
      });
    });
    const [a, b] = await Promise.all([
      e.start('https://example.test/v', 'best', dir),
      e.start('https://example.test/v', 'best', dir),
    ]);
    expect(a).not.toBe(b);
    await both;
    const paths = done.map((d) => d.filePath!);
    expect(new Set(paths).size).toBe(2);
    for (const p of paths) expect(fs.existsSync(p)).toBe(true);
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });

  it('a long emoji title yields a short, valid file name', async () => {
    const e = makeEngine();
    const p = waitFor(e, (i) => i.state === 'done');
    await e.start(`https://example.test/v?title=${encodeURIComponent('🐱'.repeat(150))}`, 'best', dir);
    const item = await p;
    expect([...path.basename(item.filePath!, '.mp4')].length).toBeLessThanOrEqual(120);
    expect(fs.existsSync(item.filePath!)).toBe(true);
  });

  it('sweeps stale .eqdl-* folders from a destination on first start only', async () => {
    const stale = path.join(dir, '.eqdl-crashed');
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, 'x.part'), 'p');
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'k');
    const e = makeEngine();
    const p = waitFor(e, (i) => i.state === 'done');
    await e.start('https://example.test/v', 'best', dir);
    await p;
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'keep.txt'))).toBe(true);
  });

  it('keeps fresh .eqdl-* folders and removes only those older than 10 minutes', async () => {
    const oldDir = path.join(dir, '.eqdl-old');
    const newDir = path.join(dir, '.eqdl-new');
    fs.mkdirSync(oldDir);
    fs.mkdirSync(newDir);
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(oldDir, old, old);
    const e = makeEngine();
    const p = waitFor(e, (i) => i.state === 'done');
    await e.start('https://example.test/v', 'best', dir);
    await p;
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('concurrent first starts into a fresh destination do not sweep each other', async () => {
    const e = makeEngine();
    const done: DownloadItem[] = [];
    const failed: DownloadItem[] = [];
    const all = new Promise<void>((resolve) => {
      e.onProgress((i) => {
        if (i.state === 'failed') failed.push(i);
        if (i.state === 'done') {
          done.push(i);
          if (done.length === 4) resolve();
        }
      });
    });
    const fresh = path.join(dir, 'fresh');
    fs.mkdirSync(fresh);
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        e.start(`https://example.test/v?title=t${n}&steps=3&stepms=150`, 'best', fresh),
      ),
    );
    await all;
    expect(failed).toEqual([]);
    expect(new Set(done.map((d) => d.filePath)).size).toBe(4);
    expect(fs.readdirSync(fresh)).toHaveLength(4);
  });

  it('start surfaces an EngineError when the destination cannot be created', async () => {
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'x');
    const err = (await makeEngine()
      .start('https://example.test/v', 'best', path.join(blocker, 'sub'))
      .then(() => null, (e: unknown) => e)) as EngineError;
    expect(err.code).toBe('unknown');
    expect(typeof err.message).toBe('string');
  });

  it('cancel after completion started does not emit cancelled', async () => {
    const e = makeEngine();
    const seen: string[] = [];
    e.onProgress((i) => seen.push(i.state));
    const p = waitFor(e, (i) => i.state === 'done');
    const id = await e.start('https://example.test/v?steps=1&stepms=0', 'best', dir);
    await p;
    await e.cancel(id);
    expect(seen).not.toContain('cancelled');
    expect((await e.list())[0]!.state).toBe('done');
  });

  it('updateEngine uses the injected updater', async () => {
    const e = makeEngine({ updater: async () => '2099.01.01' });
    expect(await e.updateEngine()).toBe('2099.01.01');
  });

  it('default updateEngine runs -U then --version', async () => {
    expect(await makeEngine().updateEngine()).toBe('fake-2.0.0');
  });
});
