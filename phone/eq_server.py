"""Runs the EqDownload site's API as one ASGI app on a self-hosted box (the S21 in Termux).

Layout on the phone:  ~/eq/site/ (the repo's site/ folder) and this file next to it.
  /api/dl     -> site/api/dl.py    (already ASGI: `app`)
  /api/probe  -> site/api/probe.py functions, plus "merged" video options for sites that serve video and
                 audio as separate streams (YouTube)
  /api/merge  -> streams video+audio joined by ffmpeg as a fragmented MP4, no temp files
Static files are served by nginx, not here.
Run:  uvicorn eq_server:app --host 127.0.0.1 --port 8082
Needs: pip install yt-dlp uvicorn yt-dlp-ejs ; pkg install ffmpeg nodejs
"""
import asyncio
import glob
import json
import os
import shutil
import sys
import tempfile
import time
from urllib.parse import parse_qs, quote

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'site', 'api'))
import dl  # noqa: E402
import probe as pr  # noqa: E402
import yt_dlp  # noqa: E402

# dl.py and probe.py build their own yt-dlp options. YouTube needs a JavaScript runtime to unscramble its
# links, and yt-dlp does not enable Node on its own, so every YoutubeDL created here gets it by default.
_orig_init = yt_dlp.YoutubeDL.__init__


def _init_with_js(self, params=None, auto_init=True):
    params = dict(params or {})
    params.setdefault('js_runtimes', {'node': {}})
    _orig_init(self, params, auto_init)


yt_dlp.YoutubeDL.__init__ = _init_with_js

MERGE_MAX_BYTES = int(os.environ.get('EQ_MERGE_MAX_MB', '700')) * 1_000_000   # refuse bigger files
MERGE_MAX_HEIGHT = int(os.environ.get('EQ_MERGE_MAX_HEIGHT', '1080'))
MERGE_SECONDS = int(os.environ.get('EQ_MERGE_SECONDS', '1500'))               # hard stop for one job
MERGE_SLOTS = asyncio.Semaphore(int(os.environ.get('EQ_MERGE_SLOTS', '1')))   # one job at a time on a phone
FFMPEG = shutil.which('ffmpeg') or 'ffmpeg'
# Fast path (OFF unless EQ_FAST_MAX_MB is set above 0; on a fast line it was slower than streaming): for files up to this size, aria2 (many connections) fetches video and audio into temp files at the same
# time, ffmpeg joins them, and the finished file is sent. Bigger files stream through the pipe path below instead,
# because nothing can be sent while a big file is still downloading, and Cloudflare gives up after 100 seconds.
FAST_MAX_BYTES = int(os.environ.get('EQ_FAST_MAX_MB', '0')) * 1_000_000
FAST_SECONDS = int(os.environ.get('EQ_FAST_SECONDS', '80'))
FAST_DIR = os.environ.get('EQ_TMP', os.path.join(os.path.expanduser('~'), 'eq', 'tmp'))
HEIGHTS = (1080, 720, 480, 360)


# Where yt-dlp keeps what it learns about YouTube's player between requests (set EQ_CACHE to move it).
CACHE_DIR = os.environ.get('EQ_CACHE', os.path.join(os.path.expanduser('~'), 'eq', 'cache'))
# Finished probe answers, kept for a few minutes so a repeat or a refresh of the same link is instant.
PROBE_TTL = int(os.environ.get('EQ_PROBE_TTL', '600'))
_PROBE_CACHE = {}


def _opts():
    return {
        'quiet': True, 'no_warnings': True, 'skip_download': True, 'noplaylist': True,
        'socket_timeout': 10, 'ignoreconfig': True,
        'allowed_extractors': ['default', '-generic'],
        'cachedir': CACHE_DIR,
        # YouTube needs a JavaScript runtime to unscramble its links. Node is installed on the phone.
        'js_runtimes': {'node': {}},
    }


# Pages allowed to read /api/probe from another address (the Vercel site sends YouTube links here).
CORS_ORIGINS = set(filter(None, os.environ.get('EQ_CORS_ORIGINS', 'https://eqdownload.vercel.app,https://download.eqqx2.com').split(',')))


async def _json(send, code, body, origin=None):
    data = json.dumps(body).encode()
    cors = [(b'access-control-allow-origin', origin.encode()), (b'vary', b'origin')] if origin in CORS_ORIGINS else []
    await send({'type': 'http.response.start', 'status': code, 'headers': cors + [
        (b'content-type', b'application/json; charset=utf-8'),
        (b'cache-control', b'no-store'),
        (b'content-length', str(len(data)).encode())]})
    await send({'type': 'http.response.body', 'body': data})


def _web(f):
    return bool(f.get('url')) and f.get('protocol') in ('https', 'http')


def _split(info):
    fmts = [f for f in info.get('formats') or [] if _web(f)]
    video = [f for f in fmts if f.get('vcodec') not in (None, 'none') and f.get('acodec') in (None, 'none') and f.get('height')]
    audio = [f for f in fmts if f.get('vcodec') in (None, 'none') and f.get('acodec') not in (None, 'none')]
    return video, audio


def _best_audio(audio):
    # m4a (AAC) first: it fits an MP4 and plays everywhere.
    return sorted(audio, key=lambda f: (f.get('ext') == 'm4a', f.get('abr') or 0), reverse=True)[0]


def _best_video(video, height):
    pool = [f for f in video if f['height'] <= height]
    if not pool:
        return None
    top = max(f['height'] for f in pool)
    pool = [f for f in pool if f['height'] == top]
    # H.264 (avc1) first: plays on every phone and TV; then the biggest bitrate.
    return sorted(pool, key=lambda f: ((f.get('vcodec') or '').startswith('avc1'), f.get('tbr') or 0), reverse=True)[0]


def _size(f):
    return f.get('filesize') or f.get('filesize_approx') or 0


def _merged_options(info, page_url, existing_heights):
    video, audio = _split(info)
    if not video or not audio:
        return []
    a = _best_audio(audio)
    out, seen = [], set()
    for h in HEIGHTS:
        if h > MERGE_MAX_HEIGHT:
            continue
        v = _best_video(video, h)
        if not v or v['height'] in seen or v['height'] in existing_heights:
            continue
        seen.add(v['height'])
        total = _size(v) + _size(a)
        if total and total > MERGE_MAX_BYTES:
            continue
        link = '/api/merge?url=' + quote(page_url, safe='') + '&h=' + str(h)   # the tier, not the real height: /api/merge only accepts the tiers in HEIGHTS
        out.append({'kind': 'video', 'label': f"{v['height']}p mp4 (with sound)", 'size': pr.size_text(total),
                    'ext': 'mp4', 'url': link, 'dl': link})
    return out


def _probe(raw):
    url, bad = pr.check_url(raw)
    if bad:
        return 400, {'error': bad}
    now = time.time()
    hit = _PROBE_CACHE.get(url)
    if hit and hit[0] > now:
        print(f'probe {url[:60]} cached', file=sys.stderr, flush=True)
        return 200, hit[1]
    code, body = _probe_uncached(url)
    print(f'probe {url[:60]} {code} {time.time() - now:.1f}s', file=sys.stderr, flush=True)
    if code == 200 and PROBE_TTL > 0:
        if len(_PROBE_CACHE) >= 64:
            for k in [k for k, v in _PROBE_CACHE.items() if v[0] <= now] or [next(iter(_PROBE_CACHE))]:
                _PROBE_CACHE.pop(k, None)
        _PROBE_CACHE[url] = (now + PROBE_TTL, body)
    return code, body


def _probe_uncached(url):
    try:
        with yt_dlp.YoutubeDL(_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
            proxy = any(True for _ in ydl.cookiejar)
        formats = pr.pick_formats(info, url, proxy)
        have = {int(f['label'].split('p')[0]) for f in formats if f['kind'] == 'video' and f['label'][:1].isdigit() and 'p' in f['label']}
        merged = _merged_options(info, url, have)
        # Merged files first (they have sound and the best quality), then the plain links, audio last.
        formats = merged + [f for f in formats if f['kind'] == 'video'] + [f for f in formats if f['kind'] != 'video']
        result = {'title': info.get('title') or 'Untitled', 'duration': info.get('duration'),
                  'thumbnail': info.get('thumbnail'), 'site': info.get('extractor_key'), 'formats': formats}
    except yt_dlp.utils.DownloadError as e:
        msg = pr.explain(str(e))
        return 422, {'error': msg, 'blocked': msg.startswith('This site blocks')}
    except Exception:
        return 500, {'error': 'Could not read that link.'}
    if not result['formats']:
        return 422, {'error': 'This link has no file that can be saved straight from the site. Use the Windows or Android app.'}
    return 200, result


def _resolve(page_url, height):
    """-> (video_fmt, audio_fmt, title) for the merge, or raises LookupError."""
    with yt_dlp.YoutubeDL(_opts()) as ydl:
        info = ydl.extract_info(page_url, download=False)
    video, audio = _split(info)
    if not video or not audio:
        raise LookupError('no separate streams')
    v = _best_video(video, height)
    if not v:
        raise LookupError('no such height')
    a = _best_audio(audio)
    total = _size(v) + _size(a)
    if total and total > MERGE_MAX_BYTES:
        raise PermissionError('too big')
    return v, a, info.get('title') or 'video'


def _safe_name(title):
    clean = ''.join(c for c in title if c not in '\\/:*?"<>|' and ord(c) >= 32).strip()[:80] or 'video'
    return clean


def _purge_old_tmp():
    try:
        for d in glob.glob(os.path.join(FAST_DIR, 'job-*')):
            if time.time() - os.path.getmtime(d) > 3600:
                shutil.rmtree(d, ignore_errors=True)
    except OSError:
        pass


async def _merge_fast(receive, send, page, v, a, title):
    """aria2 pulls both streams in parallel into temp files; ffmpeg joins them; the file is sent with its size."""
    os.makedirs(FAST_DIR, exist_ok=True)
    _purge_old_tmp()
    tmp = tempfile.mkdtemp(prefix='job-', dir=FAST_DIR)
    procs = []
    gone = asyncio.Event()

    async def watch():
        while True:
            m = await receive()
            if m['type'] == 'http.disconnect':
                gone.set()
                return
    watcher = asyncio.create_task(watch())

    async def grab(fmt, name):
        cmd = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '-q', '--no-warnings', '--no-cache-dir',
               '--js-runtimes', 'node', '--no-playlist', '--downloader', 'aria2c',
               '--downloader-args', 'aria2c:-x16 -s16 -k1M', '-f', str(fmt['format_id']),
               '-o', os.path.join(tmp, name + '.%(ext)s'), page]
        p = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL,
                                                 stderr=asyncio.subprocess.DEVNULL, stdin=asyncio.subprocess.DEVNULL)
        procs.append(p)
        return await p.wait()

    def find(name):
        hits = [f for f in glob.glob(os.path.join(tmp, name + '.*')) if not f.endswith(('.part', '.aria2', '.ytdl'))]
        return hits[0] if hits else None

    try:
        try:
            rcs = await asyncio.wait_for(asyncio.gather(grab(v, 'v'), grab(a, 'a')), timeout=FAST_SECONDS)
        except asyncio.TimeoutError:
            return await _json(send, 504, {'error': 'That took too long for this page. Use the app for big or slow downloads.'})
        vf, af = find('v'), find('a')
        if any(rcs) or not vf or not af or gone.is_set():
            return await _json(send, 502, {'error': 'The site refused the download.'})
        out = os.path.join(tmp, 'out.mp4')
        ff = await asyncio.create_subprocess_exec(
            FFMPEG, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', vf, '-i', af,
            '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', out,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, stdin=asyncio.subprocess.DEVNULL)
        procs.append(ff)
        if await ff.wait() != 0 or not os.path.exists(out):
            return await _json(send, 502, {'error': 'The site refused the download.'})
        size = os.path.getsize(out)
        if size > MERGE_MAX_BYTES:
            return await _json(send, 413, {'error': 'That file is too large for this page. Use the app.'})
        name = _safe_name(title) + '.mp4'
        await send({'type': 'http.response.start', 'status': 200, 'headers': [
            (b'content-type', b'video/mp4'), (b'content-length', str(size).encode()),
            (b'content-disposition', ("attachment; filename=\"download.mp4\"; filename*=UTF-8''" + quote(name)).encode()),
            (b'cache-control', b'no-store')]})
        with open(out, 'rb') as fh:
            while not gone.is_set():
                chunk = await asyncio.to_thread(fh.read, 262144)
                if not chunk:
                    break
                await send({'type': 'http.response.body', 'body': chunk, 'more_body': True})
        await send({'type': 'http.response.body', 'body': b'', 'more_body': False})
    finally:
        watcher.cancel()
        for p in procs:
            if p.returncode is None:
                p.kill()
        shutil.rmtree(tmp, ignore_errors=True)


async def _merge(scope, receive, send):
    qs = parse_qs(scope.get('query_string', b'').decode('latin-1'))
    if 'r' in qs:   # the page's parallel-download probe: a merge cannot do ranges, and must not start a job for it
        return await _json(send, 416, {'error': 'The site does not support ranges.'})
    raw = (qs.get('url') or [''])[0]
    try:
        height = int((qs.get('h') or ['0'])[0])
    except ValueError:
        height = 0
    page, bad = pr.check_url(raw)
    if bad or height not in HEIGHTS or height > MERGE_MAX_HEIGHT:
        return await _json(send, 400, {'error': bad or 'Bad request.'})
    if MERGE_SLOTS.locked():
        return await _json(send, 429, {'error': 'The server is busy with another download. Try again in a minute.'})
    async with MERGE_SLOTS:
        try:
            v, a, title = await asyncio.to_thread(_resolve, page, height)
        except PermissionError:
            return await _json(send, 413, {'error': 'That file is too large for this page. Use the app.'})
        except Exception:
            return await _json(send, 422, {'error': 'Could not read that link.'})
        if os.name != 'posix':
            return await _json(send, 501, {'error': 'Merging only runs on the phone server.'})
        total = _size(v) + _size(a)
        if shutil.which('aria2c') and 0 < total <= FAST_MAX_BYTES:
            return await _merge_fast(receive, send, page, v, a, title)
        # yt-dlp does the downloading (it knows each site's quirks, YouTube refuses plain requests to its links);
        # each stream goes down its own pipe into ffmpeg, which joins them without re-encoding.
        ytdlp = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '-q', '--no-warnings', '--no-cache-dir',
                 '--js-runtimes', 'node', '--no-playlist', '-o', '-']
        vr, vw = os.pipe()
        ar, aw = os.pipe()
        procs = []
        try:
            procs.append(await asyncio.create_subprocess_exec(*ytdlp, '-f', str(v['format_id']), page, stdout=vw, stderr=asyncio.subprocess.DEVNULL, stdin=asyncio.subprocess.DEVNULL))
            procs.append(await asyncio.create_subprocess_exec(*ytdlp, '-f', str(a['format_id']), page, stdout=aw, stderr=asyncio.subprocess.DEVNULL, stdin=asyncio.subprocess.DEVNULL))
            proc = await asyncio.create_subprocess_exec(
                FFMPEG, '-hide_banner', '-loglevel', 'error', '-nostdin',
                '-i', f'pipe:{vr}', '-i', f'pipe:{ar}',
                '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
                '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, pass_fds=(vr, ar))
            procs.append(proc)
        except Exception:
            for p in procs:
                p.kill()
            return await _json(send, 500, {'error': 'Could not start the download.'})
        finally:
            for fd in (vr, vw, ar, aw):
                try:
                    os.close(fd)
                except OSError:
                    pass
        gone = asyncio.Event()

        async def watch():
            while True:
                m = await receive()
                if m['type'] == 'http.disconnect':
                    gone.set()
                    return
        watcher = asyncio.create_task(watch())
        sent = 0
        started = False
        try:
            loop = asyncio.get_running_loop()
            deadline = loop.time() + MERGE_SECONDS
            while not gone.is_set() and loop.time() < deadline:
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(262144), timeout=60)
                except asyncio.TimeoutError:
                    break
                if not chunk:
                    break
                if not started:
                    name = _safe_name(title) + '.mp4'
                    await send({'type': 'http.response.start', 'status': 200, 'headers': [
                        (b'content-type', b'video/mp4'),
                        (b'content-disposition', f"attachment; filename=\"download.mp4\"; filename*=UTF-8''{quote(name)}".encode()),
                        (b'cache-control', b'no-store')]})
                    started = True
                sent += len(chunk)
                if sent > MERGE_MAX_BYTES:
                    break
                await send({'type': 'http.response.body', 'body': chunk, 'more_body': True})
            if started:
                await send({'type': 'http.response.body', 'body': b'', 'more_body': False})
            else:
                await _json(send, 502, {'error': 'The site refused the download.'})
        finally:
            watcher.cancel()
            for p in procs:
                if p.returncode is None:
                    p.kill()
                await p.wait()


async def app(scope, receive, send):
    if scope['type'] != 'http':
        return
    path = scope['path']
    if path == '/api/dl':
        return await dl.app(scope, receive, send)
    if path == '/api/merge':
        return await _merge(scope, receive, send)
    if path == '/api/probe':
        qs = parse_qs(scope.get('query_string', b'').decode('latin-1'))
        raw = (qs.get('url') or [''])[0]
        origin = dict(scope.get('headers') or []).get(b'origin', b'').decode('latin-1')
        code, body = await asyncio.to_thread(_probe, raw)
        return await _json(send, code, body, origin)
    await _json(send, 404, {'error': 'Not found.'})
