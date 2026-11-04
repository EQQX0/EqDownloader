import type { Preset } from './types';

export interface PresetSpec {
  format: string;
  extractAudio: boolean;
  audioFormat: 'mp3' | 'm4a' | null;
}

const SPECS: Record<Preset, PresetSpec> = {
  best: { format: 'bv*+ba/b', extractAudio: false, audioFormat: null },
  '1080p': { format: 'bv*[height<=1080]+ba/b[height<=1080]', extractAudio: false, audioFormat: null },
  '720p': { format: 'bv*[height<=720]+ba/b[height<=720]', extractAudio: false, audioFormat: null },
  mp3: { format: 'ba/b', extractAudio: true, audioFormat: 'mp3' },
  m4a: { format: 'ba[ext=m4a]/ba/b', extractAudio: true, audioFormat: 'm4a' },
};

/** Maps a UI preset to the downloader format selector and audio-extraction settings. */
export function presetToSpec(p: Preset): PresetSpec {
  return { ...SPECS[p] };
}
