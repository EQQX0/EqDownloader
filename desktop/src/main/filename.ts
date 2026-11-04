const MAX_LEN = 120;
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Makes a title safe to use as a Windows file name: illegal and control characters become `_`,
 * the result is cut to 120 characters (never in the middle of an emoji), and it is never empty.
 */
export function safeFileName(title: string, maxLen: number = MAX_LEN): string {
  let s = title.replace(ILLEGAL, '_');
  s = [...s].slice(0, maxLen).join('');
  s = s.replace(/[. ]+$/, '').replace(/^ +/, '');
  if (s === '') return 'download';
  const base = s.split('.')[0] ?? s;
  if (RESERVED.test(base.trim())) s = `_${s}`;
  return s;
}
