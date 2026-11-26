"""GET /api/probe?url=<link> -> title, thumbnail and direct download links.

Runs yt-dlp without downloading anything and returns only formats a phone can fetch straight from the
site's own servers: one file with sound included (https/http, no HLS or DASH), plus the best audio-only file.
Nothing is stored or logged by this function. Only TikTok and Instagram links are accepted and only their
single-post extractors are loaded, so the server never fetches an arbitrary address on a visitor's behalf.
Every host is also checked against private ranges first.
"""
import ipaddress
import json
import socket
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlparse

import yt_dlp

MAX_URL = 2000
MAX_VIDEOS = 10  # most videos listed from one post
# This page serves two sites only. The apps cover the rest.
SITES = ('tiktok.com', 'instagram.com')
# Single posts only: no profile, tag or story pages.
EXTRACTORS = ['TikTok', r'vm\.tiktok', 'Instagram']
ONLY = 'This page saves TikTok and Instagram videos only. For other sites, use the Windows or Android app.'


def addr_is_public(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr.split('%')[0])
    except ValueError:
        return False
    return (getattr(ip, 'ipv4_mapped', None) or ip).is_global


def host_is_public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
        return bool(infos) and all(addr_is_public(i[4][0]) for i in infos)
    except (OSError, ValueError):
        return False


def supported_host(host) -> bool:
    h = (host or '').lower().rstrip('.')
    return any(h == s or h.endswith('.' + s) for s in SITES)


def check_url(raw: str):
    """Return (url, None) or (None, message)."""
    if not raw or len(raw) > MAX_URL:
        return None, 'Paste a link.'
    try:
        u = urlparse(raw.strip())
        host, port = u.hostname, u.port
    except ValueError:
        return None, 'Only http and https links work.'
    if u.scheme not in ('http', 'https') or not host:
        return None, 'Only http and https links work.'
    if port not in (None, 80, 443):
        return None, 'That port is not allowed.'
    if not supported_host(host):
        return None, ONLY
    if not host_is_public(host):
        return None, 'That address is not allowed.'
    return u.geturl(), None


def size_text(n):
    if not n:
        return ''
    return f'{n / 1_000_000:.0f} MB' if n >= 1_000_000 else f'{max(1, round(n / 1000))} KB'


def silent(info) -> bool:
    """True when nothing in the post carries sound. An unknown codec counts as sound."""
    return all(f.get('acodec') == 'none' for f in info.get('formats') or [])


def pick_formats(info, page_url, proxy, index=None):
    out = []
    mute = silent(info)
    note = ' (no sound)' if mute else ''

    def dl_link(f):
        link = '/api/dl?url=' + quote(page_url, safe='') + '&f=' + quote(str(f.get('format_id')), safe='')
        return link if index is None else f'{link}&i={index}'

    def link(f):
        return dl_link(f) if proxy else f['url']

    seen = set()
    # TikTok lists a watermarked copy next to the clean one; never offer it.
    fmts = [f for f in info.get('formats') or []
            if f.get('url') and f.get('protocol') in ('https', 'http') and 'watermark' not in (f.get('format_note') or '').lower()]
    # A video track alone is offered only for a silent post; otherwise it would be a muted copy.
    both = [f for f in fmts if f.get('vcodec') != 'none' and (mute or f.get('acodec') != 'none')]
    for f in sorted(both, key=lambda f: (f.get('height') or 0, f.get('tbr') or 0), reverse=True):
        h = f.get('height') or 0
        if h in seen:
            continue
        seen.add(h)
        size = f.get('filesize') or f.get('filesize_approx')
        label = f'{h}p' if h else 'Video'
        out.append({'kind': 'video', 'label': f"{label} {f.get('ext', '')}".strip() + note, 'size': size_text(size), 'ext': f.get('ext'), 'url': link(f), 'dl': dl_link(f)})
        if len(out) == 4:
            break
    audio = [f for f in fmts if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
    if audio:
        f = sorted(audio, key=lambda f: (f.get('abr') or 0, f.get('ext') == 'm4a'), reverse=True)[0]
        size = f.get('filesize') or f.get('filesize_approx')
        out.append({'kind': 'audio', 'label': f"Audio {f.get('ext', '')}".strip(), 'size': size_text(size), 'ext': f.get('ext'), 'url': link(f)})
    return out


def list_formats(info, page_url, proxy):
    """The links for a post. A post with several videos gets the best file of each, with its position."""
    if info.get('entries') is None:
        return pick_formats(info, page_url, proxy)
    out = []
    for i, entry in enumerate(info['entries']):
        best = next((f for f in pick_formats(entry or {}, page_url, proxy, i) if f['kind'] == 'video'), None)
        if not best:
            continue
        note = ' (no sound)' if silent(entry) else ''
        best['label'] = f"Video {len(out) + 1} {best['ext'] or ''}".strip() + note
        out.append(best)
        if len(out) == MAX_VIDEOS:
            break
    return out


def probe(url: str):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        'socket_timeout': 10,
        'ignoreconfig': True,
        'allowed_extractors': EXTRACTORS,
        'cachedir': False,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        # Sites that set cookies while the page is read (TikTok) give media links a browser cannot fetch alone,
        # so those files are streamed through /api/dl, which carries the cookies.
        proxy = any(True for _ in ydl.cookiejar)
    formats = list_formats(info, url, proxy)
    first = next((e for e in info.get('entries') or [] if e), {})
    return {
        'title': info.get('title') or 'Untitled',
        'duration': info.get('duration'),
        'thumbnail': info.get('thumbnail') or first.get('thumbnail'),
        'site': info.get('extractor_key'),
        'formats': formats,
    }


def explain(err: str) -> str:
    low = err.lower()
    if 'ip address is blocked' in low:
        return 'This site blocks the server this page runs on for this post. Use the Windows or Android app on your own connection.'
    if 'no video in this post' in low or 'no video formats' in low:
        return 'No video in this post. This page saves videos and audio, not photos.'
    if any(w in low for w in ('login', 'log in', 'private', 'empty media response')) or ('age' in low and 'restricted' in low):
        return 'This post needs a login, is private, or is age restricted. The Windows and Android apps can sign in.'
    if 'unsupported url' in low:
        return 'Paste the link of a single TikTok or Instagram video.'
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
            result = probe(url)
        except yt_dlp.utils.DownloadError as e:
            msg = explain(str(e))
            return self._send(422, {'error': msg, 'blocked': msg.startswith('This site blocks')})
        except Exception:
            return self._send(500, {'error': 'Could not read that link.'})
        if not result['formats']:
            return self._send(422, {'error': 'This link has no file that can be saved straight from the site. Use the Windows or Android app.'})
        return self._send(200, result)
