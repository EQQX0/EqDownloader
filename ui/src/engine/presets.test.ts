import { describe, expect, it } from 'vitest';
import { presetToSpec } from './presets';

describe('presetToSpec', () => {
  it('maps best', () => {
    expect(presetToSpec('best')).toEqual({ format: 'bv*+ba/b', extractAudio: false, audioFormat: null });
  });

  it('maps 1080p', () => {
    expect(presetToSpec('1080p')).toEqual({
      format: 'bv*[height<=1080]+ba/b[height<=1080]',
      extractAudio: false,
      audioFormat: null,
    });
  });

  it('maps 720p', () => {
    expect(presetToSpec('720p')).toEqual({
      format: 'bv*[height<=720]+ba/b[height<=720]',
      extractAudio: false,
      audioFormat: null,
    });
  });

  it('maps mp3', () => {
    expect(presetToSpec('mp3')).toEqual({ format: 'ba/b', extractAudio: true, audioFormat: 'mp3' });
  });

  it('maps m4a', () => {
    expect(presetToSpec('m4a')).toEqual({ format: 'ba[ext=m4a]/ba/b', extractAudio: true, audioFormat: 'm4a' });
  });
});
