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
}

/**
 * Packaged builds ship yt-dlp and ffmpeg under `<resources>/bin`.
 * In development the binaries are looked up on PATH.
 */
export function resolveBinaries(opts: ResolveOptions = {}): Binaries {
  const platform = opts.platform ?? process.platform;
  const exe = platform === 'win32' ? '.exe' : '';
  const packaged = opts.packaged ?? false;
  if (!packaged) return { ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' };
  const resources =
    opts.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
  return {
    ytdlpPath: path.join(resources, 'bin', `yt-dlp${exe}`),
    ffmpegPath: path.join(resources, 'bin', `ffmpeg${exe}`),
  };
}
