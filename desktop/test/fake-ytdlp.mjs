// Fake yt-dlp used by tests. Emulates `-J` and `--newline --progress-template` output.
// Behaviour is selected through URL query params: hang=1, fail=<kind>, title=<text>, steps=<n>, stepms=<n>.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const val = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const url = argv[argv.length - 1] ?? '';
let q = new URLSearchParams();
try {
  q = new URL(url).searchParams;
} catch {}
const title = q.get('title') ?? 'Fake video';
// Like yt-dlp's %(title).120B: cut to N UTF-8 bytes without splitting a character.
const truncBytes = (str, n) => {
  let out = '';
  let used = 0;
  for (const ch of str) {
    const b = Buffer.byteLength(ch);
    if (used + b > n) break;
    out += ch;
    used += b;
  }
  return out;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAIL_MESSAGES = {
  unsupported: 'ERROR: Unsupported URL: ' + url,
  signin: 'ERROR: [youtube] abc: Sign in to confirm you are not a bot',
  region: 'ERROR: The uploader has not made this video available in your country',
  network: 'ERROR: Unable to download webpage: <urlopen error timed out>',
  outdated: 'ERROR: unable to download video data: HTTP Error 403: Forbidden',
  nsig: 'WARNING: nsig extraction failed: Some formats may be missing\nERROR: giving up',
  disk: 'ERROR: unable to write data: [Errno 28] No space left on device',
  weird: 'ERROR: something nobody has seen before',
};

if (argv.includes('-U')) {
  console.log(argv.includes('--ignore-config') ? 'Updated yt-dlp to fake-2.0.0' : 'Updated yt-dlp (no isolation)');
  process.exit(0);
}
if (argv.includes('--version')) {
  // Echo the isolation flags so tests can prove run() passes them.
  console.log(argv.includes('--ignore-config') && argv.includes('--no-plugin-dirs') ? 'fake-2.0.0' : 'fake-missing-isolation');
  process.exit(0);
}

const failKind = q.get('fail');
if (failKind) {
  console.error(FAIL_MESSAGES[failKind] ?? FAIL_MESSAGES.weird);
  process.exit(1);
}

if (argv.includes('-J')) {
  console.log(
    JSON.stringify({
      id: 'abc123',
      title,
      thumbnail: 'https://example.test/t.jpg',
      duration: 120,
      formats: [
        { format_id: '137', ext: 'mp4', height: 1080, abr: null, filesize: 50000000 },
        { format_id: '140', ext: 'm4a', height: null, abr: 128, filesize: null, filesize_approx: 2000000 },
      ],
    }),
  );
  process.exit(0);
}

// Download mode
const home = val('-P') ?? '.';
const tpl = val('-o') ?? '%(title)s [%(id)s].%(ext)s';
const audio = argv.includes('-x');
const ext = audio ? (val('--audio-format') ?? 'mp3') : 'mp4';
const name = tpl
  .replace(/%\(title\)\.(\d+)B/, (_m, n) => truncBytes(title, Number(n)))
  .replace('%(title)s', title)
  .replace('%(id)s', 'abc123')
  .replace('%(ext)s', ext);
const partPath = path.join(home, name + '.part');
const writeFiles = fs.existsSync(home);
if (writeFiles) fs.writeFileSync(partPath, 'partial');

// Real yt-dlp consumes the `download:` type prefix and prints only the template body.
const prefix = '';
const steps = Number(q.get('steps') ?? 4);
const stepMs = Number(q.get('stepms') ?? 120);
for (let i = 1; i <= steps; i++) {
  const pct = ((i * 100) / steps).toFixed(1);
  const speed = i === 1 ? 'NA' : '1000000';
  const eta = i === steps ? 'None' : String(steps - i);
  console.log(`${prefix}${pct.padStart(5)}%|${speed}|${eta}`);
  if (q.get('hang') === '1') {
    await new Promise(() => setInterval(() => {}, 1000));
  }
  await sleep(stepMs);
}
if (writeFiles) {
  fs.renameSync(partPath, path.join(home, name));
}
process.exit(0);
