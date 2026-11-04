import { existsSync } from 'node:fs';
import path from 'node:path';

export interface Binaries {
  ytdlpPath: string;
  ffmpegPath: string;
}

export interface ResolveOptions {
  /** True when running from an installed build. Electron's `app.isPackaged` in Task 4. */
  packaged?: boolean;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  /** Electron userData folder. An updated yt-dlp there beats the bundled one. */
  userDataDir?: string;
  exists?: (p: string) => boolean;
}

/**
 * Packaged builds ship yt-dlp and ffmpeg under `<resources>/bin`. An updated yt-dlp in the user
 * data folder (written by the Update button) is preferred over the bundled one.
 * In development the binaries are looked up on PATH.
 */
export function resolveBinaries(opts: ResolveOptions = {}): Binaries {
  const platform = opts.platform ?? process.platform;
  const exe = platform === 'win32' ? '.exe' : '';
  const packaged = opts.packaged ?? false;
  const exists = opts.exists ?? existsSync;
  const updated = opts.userDataDir ? path.join(opts.userDataDir, `yt-dlp${exe}`) : null;
  const preferUpdated = updated !== null && exists(updated);
  if (!packaged) return { ytdlpPath: preferUpdated ? updated : 'yt-dlp', ffmpegPath: 'ffmpeg' };
  const resources =
    opts.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
  return {
    ytdlpPath: preferUpdated ? updated : path.join(resources, 'bin', `yt-dlp${exe}`),
    ffmpegPath: path.join(resources, 'bin', `ffmpeg${exe}`),
  };
}
