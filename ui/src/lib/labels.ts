import type { DownloadState, Preset } from '../engine';

export const PRESET_LABELS: Record<Preset, string> = {
  best: 'Best',
  '1080p': '1080p',
  '720p': '720p',
  mp3: 'Audio MP3',
  m4a: 'Audio M4A',
};

export const STATE_LABELS: Record<DownloadState, string> = {
  queued: 'Queued',
  running: 'Downloading',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
