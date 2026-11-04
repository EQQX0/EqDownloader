import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EngineError } from '@eq/ui/engine';

export const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com']);
const EXE_ASSET = 'yt-dlp.exe';
const SUMS_ASSET = 'SHA2-256SUMS';

const fail = (message: string): EngineError => ({ code: 'network', message });

/** Throws unless the URL is https on one of the three GitHub hosts the updater may contact. */
export function assertAllowedUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw fail('Update blocked: invalid URL');
  }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw fail(`Update blocked: host not allowed (${u.hostname || url})`);
  }
}

/** Parses `sha256sum` output (`<64 hex>  <name>` or `<hex> *<name>`) into name -> lowercase digest. */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out.set(m[2]!, m[1]!.toLowerCase());
  }
  return out;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function verifyChecksum(data: Uint8Array, name: string, sums: Map<string, string>): void {
  const expected = sums.get(name);
  if (!expected) throw fail(`No checksum published for ${name}`);
  if (sha256Hex(data) !== expected) throw fail(`Checksum mismatch for ${name}; download discarded`);
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface UpdateOptions {
  userDataDir: string;
  fetch?: typeof fetch;
}

/**
 * Downloads the latest yt-dlp.exe into `userDataDir`, verified against the release's SHA2-256SUMS.
 * Only runs when called; never contacts hosts outside GitHub. Returns the release tag.
 */
export async function updateYtDlp(opts: UpdateOptions): Promise<string> {
  const f = opts.fetch ?? fetch;
  const get = async (url: string): Promise<Response> => {
    assertAllowedUrl(url);
    let res: Response;
    try {
      res = await f(url, { redirect: 'follow', headers: { 'User-Agent': 'EqDownload', Accept: 'application/octet-stream, application/vnd.github+json' } });
    } catch (e) {
      throw fail(`Could not reach GitHub: ${e instanceof Error ? e.message : String(e)}`);
    }
    // A redirect may have left the allowed hosts.
    if (res.url) assertAllowedUrl(res.url);
    if (!res.ok) throw fail(`GitHub returned ${res.status} for ${new URL(url).pathname}`);
    return res;
  };

  const release = (await (await get(RELEASE_API)).json()) as { tag_name?: string; assets?: ReleaseAsset[] };
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const exe = assets.find((a) => a.name === EXE_ASSET);
  const sumsAsset = assets.find((a) => a.name === SUMS_ASSET);
  if (!release.tag_name || !exe) throw fail('Latest yt-dlp release has no Windows build');
  if (!sumsAsset) throw fail('Latest yt-dlp release has no checksum file; refusing to install');

  const sums = parseChecksums(await (await get(sumsAsset.browser_download_url)).text());
  const data = Buffer.from(await (await get(exe.browser_download_url)).arrayBuffer());
  verifyChecksum(data, EXE_ASSET, sums);

  await fs.mkdir(opts.userDataDir, { recursive: true });
  const tmp = path.join(opts.userDataDir, `.${EXE_ASSET}.${process.pid}.tmp`);
  const dest = path.join(opts.userDataDir, EXE_ASSET);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw { code: 'disk', message: `Could not save update: ${e instanceof Error ? e.message : String(e)}` } satisfies EngineError;
  }
  return release.tag_name;
}
