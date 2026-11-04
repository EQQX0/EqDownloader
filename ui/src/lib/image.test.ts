import { describe, expect, it } from 'vitest';
import { safeImageSrc } from './image';

describe('safeImageSrc', () => {
  it('accepts https and data:image', () => {
    expect(safeImageSrc('https://i.test/a.jpg')).toBe('https://i.test/a.jpg');
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
  it('rejects everything else', () => {
    for (const bad of ['http://i.test/a.jpg', 'javascript:alert(1)', 'file:///c:/a.png', 'data:text/html,<b>', '//i.test/a.jpg', 'a.jpg', '', null, undefined]) {
      expect(safeImageSrc(bad as string | null)).toBeNull();
    }
  });
});
