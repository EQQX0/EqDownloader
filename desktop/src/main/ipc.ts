import path from 'node:path';
import type { EngineError, EngineErrorCode } from '@eq/ui/engine';

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: EngineError };

const CODES: readonly EngineErrorCode[] = ['unsupported', 'blocked', 'network', 'outdated', 'disk', 'unknown'];

/** Normalises anything thrown into a plain EngineError (structured clone safe). */
export function toEngineError(e: unknown): EngineError {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; message?: unknown };
    const message = typeof o.message === 'string' && o.message ? o.message : 'Something went wrong';
    const code = CODES.includes(o.code as EngineErrorCode) ? (o.code as EngineErrorCode) : 'unknown';
    return { code, message };
  }
  return { code: 'unknown', message: typeof e === 'string' && e ? e : 'Something went wrong' };
}

export async function toEnvelope<T>(fn: () => Promise<T> | T): Promise<Envelope<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toEngineError(e) };
  }
}

/** Preload side: returns the value or throws a plain `{ code, message }` object. */
export function unwrapEnvelope<T>(env: Envelope<T>): T {
  if (env.ok) return env.value;
  throw { code: env.error.code, message: env.error.message } satisfies EngineError;
}

const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/** True when `file` is strictly inside one of `folders` (no prefix or `..` tricks). */
export function isUnderAny(file: unknown, folders: readonly string[]): boolean {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const f = norm(file);
  return folders.some((d) => {
    const base = norm(d);
    const rel = path.relative(base, f);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && !same(f, base);
  });
}

/** The renderer may only download into folders the user picked or the default Downloads folder. */
export function checkDestination(dest: unknown, allowed: readonly string[]): string {
  if (typeof dest === 'string' && path.isAbsolute(dest) && allowed.some((d) => same(norm(d), norm(dest)))) return dest;
  throw { code: 'disk', message: 'That folder was not chosen in this app. Pick the destination folder again.' } satisfies EngineError;
}

/** Adds `extra` folders to `base`, skipping duplicates (case-insensitive on Windows). Order is kept. */
export function mergeFolders(base: readonly string[], extra: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of [...base, ...extra]) {
    if (!out.some((o) => same(norm(o), norm(f)))) out.push(f);
  }
  return out;
}

/** Parses the persisted folder list. Keeps only absolute paths that `isDir` accepts; anything malformed yields []. */
export function parseAllowedFolders(raw: string | null | undefined, isDir: (p: string) => boolean): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { folders?: unknown }).folders : null;
  if (!Array.isArray(list)) return [];
  const ok = list.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p) && safeIsDir(isDir, p));
  return mergeFolders([], ok);
}

function safeIsDir(isDir: (p: string) => boolean, p: string): boolean {
  try {
    return isDir(p);
  } catch {
    return false;
  }
}

export function serializeAllowedFolders(folders: readonly string[]): string {
  return JSON.stringify({ folders: mergeFolders([], folders) }, null, 2);
}
