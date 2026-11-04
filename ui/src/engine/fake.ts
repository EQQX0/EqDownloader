import type { DownloadItem, Engine, EngineError, Preset, ProbeResult } from './types';

const STEPS = [25, 50, 75, 100];

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export class FakeEngine implements Engine {
  private readonly delayMs: number;
  private readonly items = new Map<string, DownloadItem>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly handlers = new Set<(item: DownloadItem) => void>();
  private seq = 0;

  constructor(opts: { delayMs: number } = { delayMs: 50 }) {
    this.delayMs = opts.delayMs;
  }

  async probe(url: string): Promise<ProbeResult> {
    if (!isHttpUrl(url)) {
      const err: EngineError = { code: 'unsupported', message: 'Not a supported link' };
      throw err;
    }
    return {
      url,
      title: 'Fake video',
      thumbnail: null,
      durationSec: 120,
      formats: [
        { id: '137', ext: 'mp4', height: 1080, abr: null, filesize: 50_000_000 },
        { id: '140', ext: 'm4a', height: null, abr: 128, filesize: 2_000_000 },
      ],
    };
  }

  async start(url: string, preset: Preset, destination: string): Promise<string> {
    const id = `fake-${++this.seq}`;
    const item: DownloadItem = {
      id, url, title: 'Fake video', preset, state: 'queued', percent: 0,
      speedBps: null, etaSec: null, filePath: null, error: null,
    };
    this.items.set(id, item);
    this.schedule(id, 0, destination);
    return id;
  }

  async cancel(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item || item.state === 'done' || item.state === 'failed') return;
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    this.update(id, { state: 'cancelled', speedBps: null, etaSec: null });
  }

  async list(): Promise<DownloadItem[]> {
    return [...this.items.values()].map((i) => ({ ...i }));
  }

  async updateEngine(): Promise<string> {
    return 'fake-1.0.0';
  }

  onProgress(handler: (item: DownloadItem) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private schedule(id: string, step: number, destination: string): void {
    const t = setTimeout(() => {
      this.timers.delete(id);
      const percent = STEPS[step]!;
      const last = step === STEPS.length - 1;
      this.update(id, {
        state: last ? 'done' : 'running',
        percent,
        speedBps: last ? null : 1_000_000,
        etaSec: last ? null : STEPS.length - 1 - step,
        filePath: last ? `${destination}/Fake video.mp4` : null,
      });
      if (!last) this.schedule(id, step + 1, destination);
    }, this.delayMs);
    this.timers.set(id, t);
  }

  private update(id: string, patch: Partial<DownloadItem>): void {
    const next = { ...this.items.get(id)!, ...patch };
    this.items.set(id, next);
    for (const h of this.handlers) h({ ...next });
  }
}
