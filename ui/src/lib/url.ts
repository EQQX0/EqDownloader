const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[.,)]+$/;

/** Returns the first http(s) URL in the text, with trailing `.`, `,` and `)` removed. */
export function extractUrl(text: string | null): string | null {
  if (!text) return null;
  const match = URL_PATTERN.exec(text);
  if (!match) return null;
  return match[0].replace(TRAILING_PUNCTUATION, '');
}
