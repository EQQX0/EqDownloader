import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBinaries } from './paths';

describe('resolveBinaries', () => {
  it('uses resources/bin when packaged', () => {
    const r = resolveBinaries({ packaged: true, resourcesPath: 'C:\\app\\resources', platform: 'win32' });
    expect(r.ytdlpPath).toBe(path.join('C:\\app\\resources', 'bin', 'yt-dlp.exe'));
    expect(r.ffmpegPath).toBe(path.join('C:\\app\\resources', 'bin', 'ffmpeg.exe'));
  });

  it('falls back to PATH names in development', () => {
    expect(resolveBinaries({ packaged: false, platform: 'win32' })).toEqual({
      ytdlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    });
  });
});
