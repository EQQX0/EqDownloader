import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { EngineError } from '@eq/ui/engine';
import { createGetter, MAX_JSON_BYTES, MAX_SUMS_BYTES, parseChecksums, verifyChecksum } from './update';

export const APP_RELEASE_API = 'https://api.github.com/repos/EQQX0/EqDownloader/releases/latest';
const EXE_ASSET = 'EqDownload.exe';
const SUMS_ASSET = 'SHA256SUMS.txt';
export const MAX_APP_BYTES = 400 * 1024 * 1024;

const fail = (message: string): EngineError => ({ code: 'unknown', message });

/** Parses `v1.2.3` or `1.2.3` into numbers; null when it is not a plain dotted version. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  return false;
}

interface Asset {
  name: string;
  browser_download_url: string;
}

async function latest(f: typeof fetch): Promise<{ tag: string; assets: Asset[] }> {
  const get = createGetter(f);
  const rel = JSON.parse((await get(APP_RELEASE_API, MAX_JSON_BYTES)).toString('utf8')) as { tag_name?: string; assets?: Asset[] };
  if (!rel.tag_name || !parseVersion(rel.tag_name)) throw fail('GitHub returned an unreadable release');
  return { tag: rel.tag_name, assets: Array.isArray(rel.assets) ? rel.assets : [] };
}

/** Returns the newer version number, or null when this build is current. Runs only when the user asks. */
export async function checkAppUpdate(current: string, f: typeof fetch = fetch): Promise<{ version: string } | null> {
  const { tag, assets } = await latest(f);
  if (!isNewer(tag, current)) return null;
  if (!assets.some((a) => a.name === EXE_ASSET)) throw fail('The newest release has no Windows file yet');
  return { version: tag.replace(/^v/, '') };
}

/** A path is safe to put in a .cmd file when it has none of the characters cmd.exe treats specially. */
export function cmdSafe(p: string): boolean {
  return !/["%^&|<>!\r\n]/.test(p);
}

export function swapScript(newExe: string, target: string): string {
  return [
    '@echo off',
    'set /a n=0',
    ':again',
    'ping 127.0.0.1 -n 2 >nul',
    `move /y "${newExe}" "${target}" >nul 2>&1 && goto done`,
    'set /a n+=1',
    'if %n% lss 60 goto again',
    'exit /b 1',
    ':done',
    `start "" "${target}"`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');
}

export interface InstallOptions {
  current: string;
  /** The portable exe being replaced (electron-builder sets PORTABLE_EXECUTABLE_FILE). */
  target: string | undefined;
  tmpDir: string;
  fetch?: typeof fetch;
  /** Starts the swap script; replaced in tests. */
  launch?: (script: string) => void;
  maxBytes?: number;
}

/**
 * Downloads the newest EqDownload.exe, checks it against the release's SHA256SUMS.txt, stages it beside the
 * running exe and starts a script that swaps it in after this process exits. The caller then quits the app.
 */
export async function installAppUpdate(opts: InstallOptions): Promise<string> {
  if (!opts.target || !/\.exe$/i.test(opts.target)) throw fail('Updating works from the portable EqDownload.exe only. Download the new version from the website.');
  const f = opts.fetch ?? fetch;
  const { tag, assets } = await latest(f);
  if (!isNewer(tag, opts.current)) throw fail('You already have the newest version.');
  const exe = assets.find((a) => a.name === EXE_ASSET);
  const sums = assets.find((a) => a.name === SUMS_ASSET);
  if (!exe || !sums) throw fail('The newest release is missing its file or checksums; not installing.');
  const get = createGetter(f);
  const table = parseChecksums((await get(sums.browser_download_url, MAX_SUMS_BYTES)).toString('utf8'));
  const data = await get(exe.browser_download_url, opts.maxBytes ?? MAX_APP_BYTES);
  verifyChecksum(data, EXE_ASSET, table);

  const staged = path.join(path.dirname(opts.target), `.EqDownload.${tag}.new`);
  const script = path.join(opts.tmpDir, `eq-update-${process.pid}.cmd`);
  if (![staged, opts.target, script].every(cmdSafe)) throw fail('Move EqDownload.exe to a folder without special characters (such as % or &) to update it.');
  try {
    await fs.writeFile(staged, data);
    await fs.writeFile(script, swapScript(staged, opts.target));
  } catch (e) {
    await fs.rm(staged, { force: true });
    throw fail(`Could not save the update next to EqDownload.exe: ${e instanceof Error ? e.message : String(e)}`);
  }
  (opts.launch ?? ((s) => spawn('cmd.exe', ['/c', s], { detached: true, stdio: 'ignore', windowsHide: true }).unref()))(script);
  return tag.replace(/^v/, '');
}
