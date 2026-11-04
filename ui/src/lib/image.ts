/** Only https URLs and data:image URIs may be used as a thumbnail; anything else is dropped. */
export function safeImageSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  if (/^data:image\//i.test(src)) return src;
  try {
    return new URL(src).protocol === 'https:' ? src : null;
  } catch {
    return null;
  }
}
