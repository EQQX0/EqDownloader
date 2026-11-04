"""GET /api/probe?url=<link> -> title, thumbnail and direct download links.

Runs yt-dlp without downloading anything and returns only formats a phone can fetch straight from the
site's own servers: one file with sound included (https/http, no HLS or DASH), plus the best audio-only file.
Nothing is stored or logged by this function. The generic extractor is switched off so the server never
fetches an arbitrary address on a visitor's behalf, and every host is checked against private ranges first.
"""
import ipaddress
import json
import socket
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlparse

import yt_dlp

MAX_URL = 2000


def host_is_public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return False
    return bool(infos)


def check_url(raw: str):
    """Return (url, None) or (None, message)."""
    if not raw or len(raw) > MAX_URL:
        return None, 'Paste a link.'
    u = urlparse(raw.strip())
    if u.scheme not in ('http', 'https') or not u.hostname:
        return None, 'Only http and https links work.'
    if u.port not in (None, 80, 443):
        return None, 'That port is not allowed.'
    if not host_is_public(u.hostname):
        return None, 'That address is not allowed.'
    return u.geturl(), None


def size_text(n):
    if not n:
        return ''
    return f'{n / 1_000_000:.0f} MB' if n >= 1_000_000 else f'{max(1, round(n / 1000))} KB'


def pick_formats(info, page_url, proxy):
    out = []

    def link(f):
        if proxy:
            return '/api/dl?url=' + quote(page_url, safe='') + '&f=' + quote(str(f.get('format_id')), safe='')
        return f['url']

    seen = set()
    # TikTok lists a watermarked copy next to the clean one; never offer it.
    fmts = [f for f in info.get('formats') or []
            if f.get('url') and f.get('protocol') in ('https', 'http') and 'watermark' not in (f.get('format_note') or '').lower()]
    both = [f for f in fmts if f.get('vcodec') != 'none' and f.get('acodec') != 'none']
    for f in sorted(both, key=lambda f: (f.get('height') or 0, f.get('tbr') or 0), reverse=True):
        h = f.get('height') or 0
        if h in seen:
            continue
        seen.add(h)
        size = f.get('filesize') or f.get('filesize_approx')
        label = f'{h}p' if h else 'Video'
        out.append({'kind': 'video', 'label': f"{label} {f.get('ext', '')}".strip(), 'size': size_text(size), 'ext': f.get('ext'), 'url': link(f)})
        if len(out) == 4:
            break
    audio = [f for f in fmts if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
    if audio:
        f = sorted(audio, key=lambda f: (f.get('abr') or 0, f.get('ext') == 'm4a'), reverse=True)[0]
        size = f.get('filesize') or f.get('filesize_approx')
        out.append({'kind': 'audio', 'label': f"Audio {f.get('ext', '')}".strip(), 'size': size_text(size), 'ext': f.get('ext'), 'url': link(f)})
    return out


def probe(url: str, force_proxy: bool = False):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        'socket_timeout': 10,
        'ignoreconfig': True,
        'allowed_extractors': ['default', '-generic'],
        'cachedir': False,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        # Sites that set cookies while the page is read (TikTok) give media links a browser cannot fetch alone,
        # so those files are streamed through /api/dl, which carries the cookies.
        proxy = force_proxy or any(True for _ in ydl.cookiejar)
    formats = pick_formats(info, url, proxy)
    return {
        'title': info.get('title') or 'Untitled',
        'duration': info.get('duration'),
        'thumbnail': info.get('thumbnail'),
        'site': info.get('extractor_key'),
        'formats': formats,
    }


def explain(err: str) -> str:
    low = err.lower()
    if 'sign in to confirm' in low or 'not a bot' in low:
        return 'This site blocks the server this page runs on with a bot check. Use the Windows or Android app on your own connection.'
    if 'login' in low or 'private' in low or 'age' in low and 'restricted' in low:
        return 'This video needs a login, is private, or is age restricted.'
    if 'unsupported url' in low:
        return 'This site is not supported.'
    if 'geo' in low or 'not available in your country' in low:
        return 'This video is blocked in the server region.'
    return 'Could not read that link.'


class handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        raw = (parse_qs(urlparse(self.path).query).get('url') or [''])[0]
        url, bad = check_url(raw)
        if bad:
            return self._send(400, {'error': bad})
        try:
            result = probe(url, force_proxy=(parse_qs(urlparse(self.path).query).get('proxy') or [''])[0] == '1')
        except yt_dlp.utils.DownloadError as e:
            return self._send(422, {'error': explain(str(e)), 'detail': str(e)[:240]})
        except Exception:
            return self._send(500, {'error': 'Could not read that link.'})
        if not result['formats']:
            return self._send(422, {'error': 'This link has no file that can be saved straight from the site. Use the Windows or Android app.'})
        return self._send(200, result)
