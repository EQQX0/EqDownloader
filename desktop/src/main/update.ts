import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EngineError } from '@eq/ui/engine';

export const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const ALLOWED_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const MAX_HOPS = 5;
export const MAX_EXE_BYTES = 200 * 1024 * 1024;
export const MAX_SUMS_BYTES = 1024 * 1024;
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
const EXE_ASSET = 'yt-dlp.exe';
const SUMS_ASSET = 'SHA2-256SUMS';

/**
 * Updater failures keep their real message under `unknown`. Only a rejected fetch means the network is
 * down (see `unreachable`); a checksum mismatch, a blocked host or an HTTP 403 is not that.
 */
const fail = (message: string): EngineError => ({ code: 'unknown', message });
const unreachable = (message: string): EngineError => ({ code: 'network', message });

/** Throws unless the URL is https on one of the GitHub hosts the updater may contact. */
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

/** Reads a response body, rejecting as soon as it exceeds `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw fail('Download is larger than allowed; discarded');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw fail('Download is larger than allowed; discarded');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Returns a GET that only talks to the GitHub hosts and follows redirects by hand, so every Location is
 * checked BEFORE it is contacted. The body is read with a size cap.
 */
export function createGetter(f: typeof fetch, onHost?: (host: string) => void) {
  return async (start: string, maxBytes: number): Promise<Buffer> => {
    let url = start;
    for (let hop = 0; ; hop++) {
      assertAllowedUrl(url);
      onHost?.(new URL(url).hostname);
      let res: Response;
      try {
        res = await f(url, { redirect: 'manual', headers: { 'User-Agent': 'EqDownload', Accept: 'application/octet-stream, application/vnd.github+json' } });
      } catch (e) {
        throw unreachable(`Could not reach GitHub: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw fail('GitHub sent a redirect without a location');
        if (hop >= MAX_HOPS) throw fail('Too many redirects');
        try {
          url = new URL(loc, url).toString();
        } catch {
          throw fail('Update blocked: invalid redirect');
        }
        continue;
      }
      if (!res.ok) throw fail(`GitHub returned ${res.status} for ${new URL(url).pathname}`);
      return readCapped(res, maxBytes);
    }
  };
}

export interface UpdateOptions {
  userDataDir: string;
  fetch?: typeof fetch;
  /** Called with the host of every request actually made (for diagnostics). */
  onHost?: (host: string) => void;
  /** Override the yt-dlp.exe size cap (tests). */
  maxExeBytes?: number;
}

/**
 * Downloads the latest yt-dlp.exe into `userDataDir`, verified against the release's SHA2-256SUMS.
 * Only runs when called; never contacts hosts outside GitHub. Returns the release tag.
 */
export async function updateYtDlp(opts: UpdateOptions): Promise<string> {
  const get = createGetter(opts.fetch ?? fetch, opts.onHost);

  const release = JSON.parse((await get(RELEASE_API, MAX_JSON_BYTES)).toString('utf8')) as { tag_name?: string; assets?: ReleaseAsset[] };
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const exe = assets.find((a) => a.name === EXE_ASSET);
  const sumsAsset = assets.find((a) => a.name === SUMS_ASSET);
  if (!release.tag_name || !exe) throw fail('Latest yt-dlp release has no Windows build');
  if (!sumsAsset) throw fail('Latest yt-dlp release has no checksum file; refusing to install');

  const sums = parseChecksums((await get(sumsAsset.browser_download_url, MAX_SUMS_BYTES)).toString('utf8'));
  const data = await get(exe.browser_download_url, opts.maxExeBytes ?? MAX_EXE_BYTES);
  verifyChecksum(data, EXE_ASSET, sums);

  await fs.mkdir(opts.userDataDir, { recursive: true });
  const tmp = path.join(opts.userDataDir, `.${EXE_ASSET}.${process.pid}.tmp`);
  const dest = path.join(opts.userDataDir, EXE_ASSET);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    // Not 'disk': that code makes the UI name the download folder, which is not where this write happens.
    throw {
      code: 'unknown',
      message: `Could not save the updated yt-dlp.exe to ${opts.userDataDir}: ${e instanceof Error ? e.message : String(e)}`,
    } satisfies EngineError;
  }
  return release.tag_name;
}
