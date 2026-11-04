import { existsSync } from 'node:fs';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { presetToSpec } from '@eq/ui/engine';
import type {
  DownloadItem,
  Engine,
  EngineError,
  EngineErrorCode,
  FormatInfo,
  Preset,
  ProbeResult,
} from '@eq/ui/engine';
import { safeFileName } from './filename';

export const OUTPUT_TEMPLATE = '%(title).120B [%(id)s].%(ext)s';
export const PROGRESS_TEMPLATE = 'download:%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s';

/** Placed first on every yt-dlp invocation so a user's config files and plugins cannot change behaviour or traffic. */
export const ISOLATION_ARGS = ['--ignore-config', '--no-plugin-dirs'] as const;

const STDERR_CAP = 64 * 1024;
const STALE_AFTER_MS = 10 * 60 * 1000;
const STAGING_PREFIX = '.eqdl-';

export interface YtDlpEngineOptions {
  ytdlpPath: string;
  ffmpegPath: string;
  /** aria2c, when it ships next to yt-dlp: downloads then use 8 parallel connections per file. Skipped if the file is missing. */
  aria2cPath?: string;
  /** Fixed arguments placed before every yt-dlp argument (tests use it to run a Node script). */
  ytdlpArgsPrefix?: string[];
  /** Replaces the built-in `-U` self-update. Must resolve to the new version string. */
  updater?: () => Promise<string>;
}

export interface ProgressInfo {
  percent: number;
  speedBps: number | null;
  etaSec: number | null;
}

export function buildArgs(url: string, preset: Preset, destination: string): string[] {
  const spec = presetToSpec(preset);
  const args = [
    ...ISOLATION_ARGS,
    '--newline',
    '--no-colors',
    '--no-playlist',
    // Fetch HLS/DASH fragments in parallel and in 10 MB ranges: much faster, and avoids per-connection throttling.
    '-N',
    '4',
    '--http-chunk-size',
    '10M',
    '--windows-filenames',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '-f',
    spec.format,
    '-P',
    destination,
    '-o',
    OUTPUT_TEMPLATE,
  ];
  if (spec.extractAudio && spec.audioFormat) args.push('-x', '--audio-format', spec.audioFormat);
  args.push('--', url);
  return args;
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '' || t === 'NA' || t === 'None') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses `pct|speed|eta`. Real yt-dlp strips the `download:` type prefix of --progress-template,
 * so the bare form is the normal one; the prefixed form is accepted too.
 */
export function parseProgressLine(line: string): ProgressInfo | null {
  const body = line.trim().replace(/^download:/, '');
  const parts = body.split('|');
  if (parts.length !== 3) return null;
  const [pctRaw = '', speedRaw = '', etaRaw = ''] = parts;
  const pctText = pctRaw.trim();
  if (!/^\d+(\.\d+)?%$/.test(pctText)) return null;
  const percent = numOrNull(pctText.slice(0, -1));
  if (percent === null) return null;
  return { percent, speedBps: numOrNull(speedRaw), etaSec: numOrNull(etaRaw) };
}

export function mapStderr(text: string): EngineErrorCode {
  if (/Unsupported URL/i.test(text)) return 'unsupported';
  if (/Sign in|\bage\b|not available in your country/i.test(text)) return 'blocked';
  if (/Unable to download webpage/i.test(text)) return 'network';
  if (/HTTP Error 403|nsig/i.test(text)) return 'outdated';
  if (/No space left|Permission denied/i.test(text)) return 'disk';
  return 'unknown';
}

function errorFromStderr(stderr: string): EngineError {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const msg = [...lines].reverse().find((l) => l.startsWith('ERROR')) ?? lines[lines.length - 1] ?? 'yt-dlp failed';
  return { code: mapStderr(stderr), message: msg.slice(0, 300) };
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

interface Job {
  item: DownloadItem;
  staging: string;
  destination: string;
  pid: number | undefined;
  cancelled: boolean;
  completing: boolean;
  finished: boolean;
  exited: Promise<void>;
  kill: () => Promise<void>;
}

const TEMP_SUFFIX = /\.(part|ytdl|temp|tmp)$/i;

async function moveUnique(src: string, destDir: string): Promise<string> {
  const parsed = path.parse(src);
  const stem = safeFileName(parsed.name, 200);
  for (let n = 1; n < 10_000; n++) {
    const candidate = path.join(destDir, `${stem}${n === 1 ? '' : ` (${n})`}${parsed.ext}`);
    try {
      await fs.copyFile(src, candidate, fs.constants.COPYFILE_EXCL);
      await fs.rm(src, { force: true });
      return candidate;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw e;
    }
  }
  throw new Error('Could not find a free file name');
}

const rmStaging = (dir: string): Promise<void> =>
  fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

export class YtDlpEngine implements Engine {
  private readonly opts: YtDlpEngineOptions;
  private readonly jobs = new Map<string, Job>();
  private readonly swept = new Map<string, Promise<void>>();
  private readonly handlers = new Set<(item: DownloadItem) => void>();

  constructor(opts: YtDlpEngineOptions) {
    this.opts = opts;
  }

  async probe(url: string): Promise<ProbeResult> {
    if (!isHttpUrl(url)) throw { code: 'unsupported', message: 'Not a supported link' } satisfies EngineError;
    const r = await this.run(['-J', '--no-playlist', '--no-warnings', '--', url]);
    if (r.code !== 0) throw errorFromStderr(r.stderr);
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(r.stdout) as Record<string, unknown>;
    } catch {
      throw { code: 'unknown', message: 'yt-dlp returned unreadable data' } satisfies EngineError;
    }
    const rawFormats = Array.isArray(j.formats) ? (j.formats as Array<Record<string, unknown>>) : [];
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const formats: FormatInfo[] = rawFormats.map((f) => ({
      id: String(f.format_id ?? ''),
      ext: String(f.ext ?? ''),
      height: num(f.height),
      abr: num(f.abr),
      filesize: num(f.filesize) ?? num(f.filesize_approx),
    }));
    return {
      url,
      title: typeof j.title === 'string' && j.title ? j.title : url,
      thumbnail: typeof j.thumbnail === 'string' ? j.thumbnail : null,
      durationSec: num(j.duration),
      formats,
    };
  }

  async start(url: string, preset: Preset, destination: string): Promise<string> {
    if (!isHttpUrl(url)) throw { code: 'unsupported', message: 'Not a supported link' } satisfies EngineError;
    const id = randomUUID();
    // Every download works in its own staging folder, so two downloads of the same URL can never
    // write the same .part file. The finished file is moved into place under a free name.
    const staging = path.join(destination, `${STAGING_PREFIX}${id}`);
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      await this.sweepStale(destination);
      await fs.mkdir(staging, { recursive: true });
      const args = [
        ...(this.opts.ytdlpArgsPrefix ?? []),
        '--ffmpeg-location',
        this.opts.ffmpegPath,
        ...(this.opts.aria2cPath && existsSync(this.opts.aria2cPath)
          ? ['--downloader', this.opts.aria2cPath, '--downloader-args', 'aria2c:-x 8 -s 8 -k 1M']
          : []),
        ...buildArgs(url, preset, staging),
      ];
      child = spawn(this.opts.ytdlpPath, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      await rmStaging(staging).catch(() => undefined);
      const code = (e as NodeJS.ErrnoException)?.code;
      throw {
        code: code === 'ENOSPC' ? 'disk' : 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies EngineError;
    }

    const item: DownloadItem = {
      id, url, title: url, preset, state: 'queued', percent: 0,
      speedBps: null, etaSec: null, filePath: null, error: null,
    };
    let exitedResolve!: () => void;
    const exited = new Promise<void>((r) => {
      exitedResolve = r;
    });
    const job: Job = {
      item, staging, destination, pid: child.pid, cancelled: false, completing: false, finished: false, exited,
      kill: () => this.killTree(child.pid, () => child.kill()),
    };
    this.jobs.set(id, job);

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-STDERR_CAP);
    });
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r\n|\n|\r/);
      buf = lines.pop() ?? '';
      for (const line of lines) this.onLine(job, line);
    });

    let settled = false;
    const settle = (fn: () => Promise<void>): void => {
      if (settled) return;
      settled = true;
      void fn()
        .catch((e: unknown) => {
          if (job.cancelled || job.finished) return;
          this.fail(job, { code: 'unknown', message: e instanceof Error ? e.message : String(e) });
        })
        .finally(exitedResolve);
    };
    child.once('error', (e) =>
      settle(async () => {
        await rmStaging(staging);
        if (!job.cancelled) this.fail(job, { code: 'unknown', message: e.message });
      }),
    );
    child.once('close', (code) =>
      settle(async () => {
        if (buf) this.onLine(job, buf);
        if (job.cancelled) return;
        if (code === 0) {
          job.completing = true;
          await this.complete(job);
        } else {
          await rmStaging(staging);
          this.fail(job, errorFromStderr(stderr));
        }
      }),
    );
    return id;
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || job.finished || job.cancelled || job.completing) return;
    job.cancelled = true;
    await job.kill();
    await Promise.race([job.exited, new Promise((r) => setTimeout(r, 5000))]);
    await rmStaging(job.staging);
    if (job.finished) return;
    job.finished = true;
    this.update(job, { state: 'cancelled', speedBps: null, etaSec: null });
  }

  async list(): Promise<DownloadItem[]> {
    return [...this.jobs.values()].map((j) => ({ ...j.item }));
  }

  async updateEngine(): Promise<string> {
    if (this.opts.updater) return this.opts.updater();
    const u = await this.run(['-U']);
    if (u.code !== 0) throw errorFromStderr(u.stderr || u.stdout);
    const v = await this.run(['--version']);
    if (v.code !== 0) throw errorFromStderr(v.stderr);
    return v.stdout.trim();
  }

  onProgress(handler: (item: DownloadItem) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Process id of a download's yt-dlp child, if known. */
  pidOf(id: string): number | undefined {
    return this.jobs.get(id)?.pid;
  }

  /**
   * Removes `.eqdl-*` folders older than 10 minutes (left by crashed runs), once per destination
   * per engine. Every start() awaits the same promise before creating its own staging folder.
   */
  private sweepStale(destination: string): Promise<void> {
    const key = path.resolve(destination);
    let p = this.swept.get(key);
    if (!p) {
      p = this.doSweep(key);
      this.swept.set(key, p);
    }
    return p;
  }

  private async doSweep(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    const active = new Set([...this.jobs.values()].map((j) => path.resolve(j.staging)));
    const cutoff = Date.now() - STALE_AFTER_MS;
    await Promise.all(
      names
        .filter((n) => n.startsWith(STAGING_PREFIX))
        .map(async (n) => {
          const full = path.join(dir, n);
          if (active.has(path.resolve(full))) return;
          try {
            if ((await fs.stat(full)).mtimeMs >= cutoff) return;
            await rmStaging(full);
          } catch {
            /* best effort */
          }
        }),
    );
  }

  private onLine(job: Job, line: string): void {
    if (job.cancelled || job.finished) return;
    const p = parseProgressLine(line.trim());
    if (!p) return;
    this.update(job, { state: 'running', percent: p.percent, speedBps: p.speedBps, etaSec: p.etaSec });
  }

  private async complete(job: Job): Promise<void> {
    const names = (await fs.readdir(job.staging)).filter((n) => !TEMP_SUFFIX.test(n));
    const stats = await Promise.all(
      names.map(async (n) => ({ n, t: (await fs.stat(path.join(job.staging, n))).mtimeMs })),
    );
    stats.sort((a, b) => b.t - a.t);
    const newest = stats[0];
    if (!newest) {
      await rmStaging(job.staging);
      this.fail(job, { code: 'unknown', message: 'yt-dlp finished but produced no file' });
      return;
    }
    const finalPath = await moveUnique(path.join(job.staging, newest.n), job.destination);
    await rmStaging(job.staging);
    job.finished = true;
    this.update(job, {
      state: 'done', percent: 100, speedBps: null, etaSec: null,
      filePath: finalPath, title: path.parse(finalPath).name,
    });
  }

  private fail(job: Job, error: EngineError): void {
    if (job.finished) return;
    job.finished = true;
    this.update(job, { state: 'failed', speedBps: null, etaSec: null, error });
  }

  private update(job: Job, patch: Partial<DownloadItem>): void {
    job.item = { ...job.item, ...patch };
    for (const h of this.handlers) h({ ...job.item });
  }

  private async killTree(pid: number | undefined, fallback: () => void): Promise<void> {
    if (pid === undefined) return;
    if (process.platform === 'win32') {
      // yt-dlp may have ffmpeg children; /T takes the whole tree down.
      const ok = await new Promise<boolean>((resolve) => {
        const k = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true });
        k.once('error', () => resolve(false));
        k.once('close', (c) => resolve(c === 0));
      });
      if (!ok) fallback();
    } else {
      fallback();
    }
  }

  private run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.ytdlpPath, [...(this.opts.ytdlpArgsPrefix ?? []), ...ISOLATION_ARGS, ...args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString('utf8')).slice(-STDERR_CAP);
      });
      child.once('error', (e) => reject({ code: 'unknown', message: e.message } satisfies EngineError));
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
  }
}
