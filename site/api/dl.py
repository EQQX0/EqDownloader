"""GET /api/dl?url=<page link>&f=<format id> -> the media file, streamed with a download header.

Some sites (TikTok) give media links that only work with cookies set while the page is read, so a browser
cannot fetch them itself. This function reads the page the same way /api/probe does, then streams the chosen
file through to the visitor. It is an ASGI app so the body streams instead of being buffered.
Nothing is stored. Files over MAX_BYTES are refused, and every host (and every redirect, and the address reached) is checked against private ranges.
"""
import asyncio
import ipaddress
import json
import re
import socket
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, urlparse

import yt_dlp

MAX_BYTES = 80_000_000
CHUNK = 512 * 1024  # a thread hop per chunk: big chunks keep it fast


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


def public_http_url(raw: str) -> bool:
    u = urlparse(raw or '')
    return u.scheme in ('http', 'https') and bool(u.hostname) and u.port in (None, 80, 443) and host_is_public(u.hostname)


def resolve(page_url: str, format_id: str):
    opts = {
        'quiet': True, 'no_warnings': True, 'skip_download': True, 'noplaylist': True, 'socket_timeout': 10,
        'ignoreconfig': True, 'allowed_extractors': ['default', '-generic'], 'cachedir': False,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(page_url, download=False)
        chosen = next((f for f in info.get('formats') or [] if f.get('format_id') == format_id and f.get('url')), None)
        if not chosen:
            raise LookupError('format')
        media = chosen['url']
        if not public_http_url(media):
            raise PermissionError('host')
        headers = dict(chosen.get('http_headers') or info.get('http_headers') or {})
        cookie = ydl.cookiejar.get_cookie_header(media)
        if cookie:
            headers['Cookie'] = cookie
        return media, headers, info.get('title') or 'video', (re.fullmatch(r'[A-Za-z0-9]{1,5}', chosen.get('ext') or '') and chosen['ext']) or 'mp4'


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only when its target is also a public http(s) address."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not public_http_url(newurl):
            raise urllib.error.URLError('redirect blocked')
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urlparse(newurl).hostname != urlparse(req.full_url).hostname:
            new.headers.pop('Cookie', None)  # never send a site's cookies to another host
            new.unredirected_hdrs.pop('Cookie', None)
        return new


OPENER = urllib.request.build_opener(SafeRedirect)


def open_media(media, headers):
    resp = OPENER.open(urllib.request.Request(media, headers=headers), timeout=20)
    # DNS can change between the check and the connect, so check the address actually reached too.
    try:
        peer = ipaddress.ip_address(resp.fp.raw._sock.getpeername()[0])
        if peer.is_private or peer.is_loopback or peer.is_link_local or peer.is_multicast or peer.is_reserved or peer.is_unspecified:
            resp.close()
            raise PermissionError('peer')
    except AttributeError:
        pass
    return resp


def safe_name(title: str, ext: str) -> str:
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '', title).strip()[:80] or 'video'
    return f'{base}.{ext}'


async def reply_json(send, code, body):
    data = json.dumps(body).encode()
    await send({'type': 'http.response.start', 'status': code, 'headers': [
        (b'content-type', b'application/json; charset=utf-8'), (b'cache-control', b'no-store'), (b'content-length', str(len(data)).encode())]})
    await send({'type': 'http.response.body', 'body': data})


async def app(scope, receive, send):
    if scope['type'] != 'http':
        return
    qs = parse_qs(scope.get('query_string', b'').decode())
    page = (qs.get('url') or [''])[0]
    fid = (qs.get('f') or [''])[0]
    if not fid or len(page) > 2000 or not public_http_url(page):
        return await reply_json(send, 400, {'error': 'Bad link.'})
    try:
        media, headers, title, ext = await asyncio.to_thread(resolve, page, fid)
    except (LookupError, PermissionError):
        return await reply_json(send, 422, {'error': 'That file is not available.'})
    except Exception:
        return await reply_json(send, 422, {'error': 'Could not read that link.'})
    try:
        resp = await asyncio.to_thread(open_media, media, headers)
    except Exception:
        return await reply_json(send, 502, {'error': 'The site refused the download.'})
    length = resp.headers.get('Content-Length')
    if length and length.isdigit() and int(length) > MAX_BYTES:
        resp.close()
        return await reply_json(send, 413, {'error': 'That file is too large for this page. Use the app.'})
    name = safe_name(title, ext)
    head = [
        (b'content-type', (resp.headers.get('Content-Type') or 'application/octet-stream').encode()),
        (b'content-disposition', f"attachment; filename=\"download.{ext}\"; filename*=UTF-8''{quote(name)}".encode()),
        (b'cache-control', b'no-store'),
    ]
    if length and length.isdigit():
        head.append((b'content-length', length.encode()))
    await send({'type': 'http.response.start', 'status': 200, 'headers': head})
    sent = 0
    try:
        while True:
            chunk = await asyncio.to_thread(resp.read, CHUNK)
            if not chunk:
                break
            sent += len(chunk)
            if sent > MAX_BYTES:
                # Abort the connection so the browser sees a failed download, not a short file that looks complete.
                raise RuntimeError('too large')
            await send({'type': 'http.response.body', 'body': chunk, 'more_body': True})
    finally:
        resp.close()
    await send({'type': 'http.response.body', 'body': b'', 'more_body': False})
