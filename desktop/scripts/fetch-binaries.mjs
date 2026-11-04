// Downloads yt-dlp.exe and ffmpeg.exe into desktop/resources/bin, verifying SHA-256 against pins below.
// Idempotent: files that already match their pin are left alone. A mismatch is a hard failure.
//
// Updating a pin (trust on first use): change the tag/URL, set the hash to '' and run the script. It
// downloads, prints the computed SHA-256 and exits non-zero. Cross-check that value against the
// release's published checksum (SHA2-256SUMS for yt-dlp, checksums.sha256 / asset digest for BtbN),
// then commit it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const YTDLP_TAG = '2026.10.26';
// BtbN deletes daily builds after about two weeks. Pin a month-end build (autobuild-YYYY-MM-DD-*) and
// re-pin before it ages out of the release list.
const FFMPEG_TAG = 'autobuild-2026-10-31-12-59';
const FFMPEG_ZIP = 'ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip';

const PINS = {
  ytdlpExe: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
  ffmpegZip: '401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f',
  ffmpegExe: 'c46215f8889634396f0ac0acac738ef2145175e5b6caf28b3daa8ac9a9980c5f',
};

const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/yt-dlp.exe`;
const FFMPEG_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_TAG}/${FFMPEG_ZIP}`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'resources', 'bin');

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });

async function matches(file, pin) {
  if (!pin || !fs.existsSync(file)) return false;
  return (await sha256File(file)) === pin;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  const out = fs.createWriteStream(dest);
  const h = createHash('sha256');
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
    if (!out.write(value)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  return h.digest('hex');
}

function requirePin(name, pin, actual) {
  if (!pin) {
    console.error(`No pin committed for ${name}. Computed SHA-256: ${actual}`);
    console.error('Cross-check it against the published checksum, then set it in PINS.');
    process.exit(1);
  }
  if (actual !== pin) {
    console.error(`CHECKSUM MISMATCH for ${name}\n  expected ${pin}\n  actual   ${actual}`);
    process.exit(1);
  }
}

fs.mkdirSync(binDir, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-fetch-'));
try {
  const ytdlpDest = path.join(binDir, 'yt-dlp.exe');
  if (await matches(ytdlpDest, PINS.ytdlpExe)) {
    console.log('yt-dlp.exe: up to date');
  } else {
    console.log(`yt-dlp.exe: downloading ${YTDLP_TAG}`);
    const tmp = path.join(work, 'yt-dlp.exe');
    requirePin('yt-dlp.exe', PINS.ytdlpExe, await download(YTDLP_URL, tmp));
    fs.copyFileSync(tmp, ytdlpDest);
  }

  const ffmpegDest = path.join(binDir, 'ffmpeg.exe');
  const licenseDest = path.join(binDir, 'ffmpeg-LICENSE.txt');
  if ((await matches(ffmpegDest, PINS.ffmpegExe)) && fs.existsSync(licenseDest)) {
    console.log('ffmpeg.exe: up to date');
  } else {
    console.log(`ffmpeg.exe: downloading ${FFMPEG_ZIP} (large)`);
    const zip = path.join(work, 'ffmpeg.zip');
    requirePin('ffmpeg zip', PINS.ffmpegZip, await download(FFMPEG_URL, zip));
    const extractDir = path.join(work, 'x');
    fs.mkdirSync(extractDir);
    // Windows ships bsdtar (reads zip). Use it by full path: Git Bash puts GNU tar first on PATH.
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zip, '-C', extractDir, '*/bin/ffmpeg.exe', '*/LICENSE.txt'], { stdio: 'inherit' });
    const found = fs.readdirSync(extractDir, { withFileTypes: true }).find((d) => d.isDirectory());
    const extracted = found && path.join(extractDir, found.name, 'bin', 'ffmpeg.exe');
    if (!extracted || !fs.existsSync(extracted)) throw new Error('ffmpeg.exe not found in archive');
    const license = path.join(extractDir, found.name, 'LICENSE.txt');
    if (!fs.existsSync(license)) throw new Error('LICENSE.txt not found in archive');
    requirePin('ffmpeg.exe', PINS.ffmpegExe, await sha256File(extracted));
    fs.copyFileSync(extracted, ffmpegDest);
    // The GPL text travels with the exe. It comes from the zip, whose hash is pinned above.
    fs.copyFileSync(license, licenseDest);
  }
  console.log('binaries ready in', binDir);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
