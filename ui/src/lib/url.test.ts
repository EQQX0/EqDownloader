import { describe, expect, it } from 'vitest';
import { extractUrl } from './url';

describe('extractUrl', () => {
  it('returns the first URL embedded in text', () => {
    expect(extractUrl('Watch this https://youtu.be/x now')).toBe('https://youtu.be/x');
  });

  it('trims trailing punctuation like ")."', () => {
    expect(extractUrl('see https://a.test/p).')).toBe('https://a.test/p');
  });

  it('trims a trailing comma', () => {
    expect(extractUrl('https://a.test/p, and more')).toBe('https://a.test/p');
  });

  it('returns null when there is no URL', () => {
    expect(extractUrl('hello')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractUrl('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractUrl(null)).toBeNull();
  });
});
