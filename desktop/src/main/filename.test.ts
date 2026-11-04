import { describe, expect, it } from 'vitest';
import { safeFileName } from './filename';

describe('safeFileName', () => {
  it('replaces Windows-illegal characters with underscores', () => {
    expect(safeFileName('a<b>:c|d?.mp4')).toBe('a_b__c_d_.mp4');
    expect(safeFileName('x"y/z\\w*')).toBe('x_y_z_w_');
  });

  it('replaces control characters', () => {
    expect(safeFileName('a\u0000b\u001fc\u007fd')).toBe('a_b_c_d');
  });

  it('keeps emoji and non-latin text intact', () => {
    expect(safeFileName('Cat 🐱 video 日本語')).toBe('Cat 🐱 video 日本語');
  });

  it('trims a 300 character title to 120 characters', () => {
    expect(safeFileName('x'.repeat(300))).toHaveLength(120);
  });

  it('never splits an emoji surrogate pair when trimming', () => {
    const out = safeFileName('🐱'.repeat(200));
    expect([...out]).toHaveLength(120);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('never returns an empty string', () => {
    expect(safeFileName('')).toBe('download');
    expect(safeFileName('   ')).toBe('download');
    expect(safeFileName('...')).toBe('download');
  });

  it('avoids Windows reserved device names and trailing dots/spaces', () => {
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('name. ')).toBe('name');
  });
});
