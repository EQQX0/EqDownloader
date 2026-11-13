import { describe, expect, it } from 'vitest';
import { describeError } from './errors';

describe('describeError blocked', () => {
  it('turns the TikTok login message into a sign-in hint that allows Retry', () => {
    const e = describeError(
      { code: 'blocked', message: 'ERROR: [TikTok] 1: This post may not be comfortable for some audiences. Log in for access. Use --cookies-from-browser or --cookies for the authentication.' },
      'Downloads',
    );
    expect(e.needsLogin).toBe(true);
    expect(e.message).toContain('Settings');
    expect(e.message).not.toContain('--cookies');
  });

  it('keeps other blocked reasons as they are', () => {
    const e = describeError({ code: 'blocked', message: 'This video is not available in your country' }, 'Downloads');
    expect(e.needsLogin).toBeUndefined();
    expect(e.message).toBe('This video is not available in your country');
  });
});
