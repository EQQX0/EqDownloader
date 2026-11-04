"""EqDownload Home: the website, run on your own PC so YouTube sees your home connection.

Serves ../site and the same /api/probe and /api/dl endpoints the Vercel site has, plus /api/mix, which
joins separate video and audio (YouTube's 1080p and up) with ffmpeg. Nothing is stored: mixed files go to a
temp folder and are deleted when the transfer ends. By default it listens on this PC only (127.0.0.1).
Pass --lan to let phones on your Wi-Fi reach it. Do not expose it to the internet.
"""
import argparse
import json
import mimetypes
import os
import shutil
import sys
import tempfile
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
sys.path.insert(0, str(SITE / 'api'))

import yt_dlp  # noqa: E402
import probe as sp  # noqa: E402  (the Vercel site's probe module)
import dl as sd  # noqa: E402  (its download resolver)

CHUNK = 256 * 1024
MAX_BYTES = 8_000_000_000


def find_ffmpeg():
    cands = [os.environ.get('EQ_FFMPEG'), shutil.which('ffmpeg'),
             str(ROOT / 'desktop' / 'resources' / 'bin' / 'ffmpeg.exe')]
    return next((c for c in cands if c and Path(c).exists()), None)


FFMPEG = find_ffmpeg()
OPTS = {'quiet': True, 'no_warnings': True, 'skip_download': True, 'noplaylist': True, 'socket_timeout': 15,
        'ignoreconfig': True, 'allowed_extractors': ['default', '-generic'], 'cachedir': False}
BOT_TEXT = 'Use the Windows or Android app on your own connection.'


def probe_home(url):
    with yt_dlp.YoutubeDL(OPTS) as ydl:
        info = ydl.extract_info(url, download=False)
    formats = sp.pick_formats(info, url, True)
    if FFMPEG:
        have = {f['label'].split('p')[0] for f in formats if f['kind'] == 'video'}
        heights = sorted({f.get('height') for f in info.get('formats') or []
                          if f.get('vcodec') not in (None, 'none') and f.get('acodec') == 'none' and (f.get('height') or 0) >= 240},
                         reverse=True)
        extra = [{'kind': 'video', 'label': f'{h}p mp4 (joined)', 'size': '', 'ext': 'mp4',
                  'url': '/api/mix?url=' + quote(url, safe='') + f'&h={h}'} for h in heights if str(h) not in have][:3]
        formats = extra + formats
    return {'title': info.get('title') or 'Untitled', 'duration': info.get('duration'),
            'thumbnail': info.get('thumbnail'), 'site': info.get('extractor_key'), 'formats': formats}


def disposition(title, ext):
    name = sd.safe_name(title, ext)
    return "attachment; filename=\"download.%s\"; filename*=UTF-8''%s" % (ext, quote(name))


class Handler(BaseHTTPRequestHandler):
    server_version = 'EqDownloadHome'

    def log_message(self, *a):
        pass

    def send_json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def stream(self, fh, head):
        self.send_response(200)
        for k, v in head.items():
            self.send_header(k, v)
        self.end_headers()
        sent = 0
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            sent += len(chunk)
            if sent > MAX_BYTES:
                break
            self.wfile.write(chunk)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == '/api/probe':
                return self.api_probe(q)
            if u.path == '/api/dl':
                return self.api_dl(q)
            if u.path == '/api/mix':
                return self.api_mix(q)
            return self.static(u.path)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def api_probe(self, q):
        url, bad = sp.check_url((q.get('url') or [''])[0])
        if bad:
            return self.send_json(400, {'error': bad})
        try:
            result = probe_home(url)
        except yt_dlp.utils.DownloadError as e:
            msg = sp.explain(str(e)).replace(BOT_TEXT, 'Try again later, or run start.bat again to update yt-dlp.')
            return self.send_json(422, {'error': msg, 'detail': str(e)[:240]})
        except Exception:
            return self.send_json(500, {'error': 'Could not read that link.'})
        if not result['formats']:
            return self.send_json(422, {'error': 'No saveable file found for that link.'})
        return self.send_json(200, result)

    def api_dl(self, q):
        url, bad = sp.check_url((q.get('url') or [''])[0])
        fid = (q.get('f') or [''])[0]
        if bad or not fid:
            return self.send_json(400, {'error': 'Bad link.'})
        try:
            media, headers, title, ext = sd.resolve(url, fid)
            resp = urllib.request.urlopen(urllib.request.Request(media, headers=headers), timeout=30)
        except Exception:
            return self.send_json(502, {'error': 'The site refused the download.'})
        head = {'Content-Type': resp.headers.get('Content-Type') or 'application/octet-stream',
                'Content-Disposition': disposition(title, ext), 'Cache-Control': 'no-store'}
        if resp.headers.get('Content-Length'):
            head['Content-Length'] = resp.headers['Content-Length']
        try:
            self.stream(resp, head)
        finally:
            resp.close()

    def api_mix(self, q):
        url, bad = sp.check_url((q.get('url') or [''])[0])
        h = (q.get('h') or [''])[0]
        if bad or not h.isdigit() or not FFMPEG:
            return self.send_json(400, {'error': 'Bad request.'})
        tmp = tempfile.mkdtemp(prefix='eqhome-')
        try:
            fmt = 'bv*[height<=%d]+ba/b[height<=%d]' % (int(h), int(h))
            opts = dict(OPTS, skip_download=False, ffmpeg_location=FFMPEG, merge_output_format='mp4',
                        format=fmt, outtmpl=os.path.join(tmp, 'out.%(ext)s'))
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            files = list(Path(tmp).glob('out.*'))
            if not files:
                return self.send_json(502, {'error': 'Could not build that file.'})
            f = files[0]
            with open(f, 'rb') as fh:
                self.stream(fh, {'Content-Type': 'video/mp4', 'Content-Length': str(f.stat().st_size),
                                 'Content-Disposition': disposition(info.get('title') or 'video', f.suffix.lstrip('.') or 'mp4'),
                                 'Cache-Control': 'no-store'})
        except yt_dlp.utils.DownloadError:
            return self.send_json(502, {'error': 'The site refused the download.'})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def static(self, path):
        rel = 'index.html' if path in ('', '/') else path.lstrip('/')
        f = (SITE / rel).resolve()
        ok = SITE.resolve() in f.parents and f.is_file() and f.relative_to(SITE.resolve()).parts[0] not in ('api', '.vercel')
        if not ok or f.suffix in ('.py', '.txt', '.json') and f.name != 'site.webmanifest':
            self.send_response(404)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        data = f.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(f.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lan', action='store_true', help='listen on the local network so phones can reach it')
    ap.add_argument('--port', type=int, default=8765)
    a = ap.parse_args()
    host = '0.0.0.0' if a.lan else '127.0.0.1'
    where = '<this PC address>' if a.lan else 'localhost'
    ff = 'found' if FFMPEG else 'not found, 1080p+ joining off'
    print('EqDownload Home on http://%s:%d (yt-dlp %s, ffmpeg %s)' % (where, a.port, yt_dlp.version.__version__, ff))
    ThreadingHTTPServer((host, a.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
