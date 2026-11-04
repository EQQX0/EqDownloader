import { describe, expect, it } from 'vitest';
import type { DownloadItem, Engine, EngineError } from './types';

export function runEngineContract(name: string, make: () => Engine): void {
  describe(`Engine contract: ${name}`, () => {
    it('probe returns a title and at least one format', async () => {
      const r = await make().probe('https://example.test/v');
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.formats.length).toBeGreaterThan(0);
    });

    it('probe rejects a non-url with code unsupported', async () => {
      const err = (await make()
        .probe('not a url')
        .then(() => null, (e: unknown) => e)) as EngineError | null;
      expect(err).not.toBeNull();
      expect(err?.code).toBe('unsupported');
    });

    it('start returns an id that appears in list()', async () => {
      const e = make();
      const id = await e.start('https://example.test/v', 'best', '/tmp');
      expect((await e.list()).some((i) => i.id === id)).toBe(true);
    });

    it('progress events end with state done and percent 100', async () => {
      const e = make();
      const events: DownloadItem[] = [];
      const done = new Promise<void>((resolve) => {
        e.onProgress((i) => {
          events.push(i);
          if (i.state === 'done') resolve();
        });
      });
      await e.start('https://example.test/v', '720p', '/tmp');
      await done;
      const last = events[events.length - 1]!;
      expect(last.state).toBe('done');
      expect(last.percent).toBe(100);
    });

    it('cancel on a running id yields state cancelled', async () => {
      const e = make();
      let running!: () => void;
      const sawRunning = new Promise<void>((resolve) => {
        running = resolve;
      });
      e.onProgress((i) => {
        if (i.state === 'running') running();
      });
      const id = await e.start('https://example.test/v', 'mp3', '/tmp');
      await sawRunning;
      await e.cancel(id);
      const item = (await e.list()).find((i) => i.id === id);
      expect(item?.state).toBe('cancelled');
    });
  });
}
