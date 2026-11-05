"""Offline tests for the site's functions: python -m unittest discover -s site/api -p "test_*.py" """
import unittest
import urllib.error

import dl
import probe


class CheckUrl(unittest.TestCase):
    def test_rejects_private_and_odd_addresses(self):
        for bad in ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest', 'http://[::1]/',
                    'http://2130706433/', 'http://0x7f000001/', 'http://10.0.0.5/', 'file:///etc/passwd',
                    'ftp://example.com/', 'http://example.com:8080/', '']:
            self.assertIsNotNone(probe.check_url(bad)[1], bad)

    def test_rejects_long_input(self):
        self.assertIsNotNone(probe.check_url('https://example.com/' + 'a' * 2100)[1])


class PickFormats(unittest.TestCase):
    def info(self):
        def f(i, h, note='', v='avc1', a='mp4a', proto='https'):
            return {'format_id': i, 'url': 'https://cdn.example/' + i, 'height': h, 'format_note': note,
                    'vcodec': v, 'acodec': a, 'protocol': proto, 'ext': 'mp4', 'tbr': h}
        return {'formats': [f('wm', 720, 'Direct video (watermarked)'), f('720', 720), f('360', 360),
                            f('hls', 1080, proto='m3u8_native'), f('aud', 0, v='none', a='mp4a')]}

    def test_skips_watermarked_and_streamed_formats(self):
        urls = [x['url'] for x in probe.pick_formats(self.info(), 'https://x.example/v', False)]
        self.assertNotIn('https://cdn.example/wm', urls)
        self.assertNotIn('https://cdn.example/hls', urls)
        self.assertIn('https://cdn.example/720', urls)

    def test_proxy_links_use_the_download_endpoint(self):
        links = [x['url'] for x in probe.pick_formats(self.info(), 'https://x.example/v', True)]
        self.assertTrue(all(u.startswith('/api/dl?url=') for u in links))


class Explain(unittest.TestCase):
    def test_bot_check_message(self):
        self.assertTrue(probe.explain("Sign in to confirm you're not a bot").startswith('This site blocks'))

    def test_unknown_error_is_generic(self):
        self.assertEqual(probe.explain('boom'), 'Could not read that link.')


class Redirects(unittest.TestCase):
    def test_redirect_to_private_address_is_refused(self):
        h = dl.SafeRedirect()
        with self.assertRaises(urllib.error.URLError):
            h.redirect_request(None, None, 302, 'Found', {}, 'http://169.254.169.254/')

    def test_safe_name_strips_path_characters(self):
        self.assertEqual(dl.safe_name(r'a/b\c:d', 'mp4'), 'abcd.mp4')




class Ranges(unittest.TestCase):
    def run_dl(self, query):
        import asyncio
        sent = []

        async def send(m):
            sent.append(m)

        scope = {'type': 'http', 'query_string': query.encode()}
        asyncio.run(dl.app(scope, None, send))
        return sent[0]['status']

    def test_bad_range_is_refused_before_any_lookup(self):
        orig, orig_pub = dl.resolve, dl.public_http_url
        dl.resolve = lambda *a: ('https://example.com/v.mp4', {}, 't', 'mp4')
        dl.public_http_url = lambda u: True
        try:
            self.assertEqual(self.run_dl('url=https%3A%2F%2Fexample.com%2Fp&f=1&r=abc'), 400)
            self.assertEqual(self.run_dl('url=https%3A%2F%2Fexample.com%2Fp&f=1&r=9-1'), 400)
        finally:
            dl.resolve, dl.public_http_url = orig, orig_pub


def fake_addrinfo(*addrs):
    return lambda host, port, *a, **k: [(2, 1, 6, '', (x, 0)) for x in addrs]


class HostAllowlist(unittest.TestCase):
    def check(self, mod, addrs, expect):
        import socket
        orig = socket.getaddrinfo
        socket.getaddrinfo = fake_addrinfo(*addrs)
        try:
            self.assertEqual(mod.host_is_public('h.example'), expect, addrs)
        finally:
            socket.getaddrinfo = orig

    def test_allowlist_in_both_modules(self):
        for mod in (dl, probe):
            self.check(mod, ['93.184.216.34'], True)
            self.check(mod, ['100.64.0.1'], False)  # CGNAT
            self.check(mod, ['::ffff:127.0.0.1'], False)  # mapped loopback
            self.check(mod, ['::ffff:100.64.0.1'], False)
            self.check(mod, ['93.184.216.34', '10.0.0.1'], False)

    def test_odd_hostnames_fail_closed(self):
        import socket
        orig = socket.getaddrinfo
        try:
            for exc in (UnicodeError('label empty'), ValueError('bad')):
                def boom(*a, **k):
                    raise exc
                socket.getaddrinfo = boom
                self.assertFalse(dl.host_is_public('x'))
                self.assertFalse(probe.host_is_public('x'))
                self.assertIsNotNone(probe.check_url('http://x.example/')[1])
        finally:
            socket.getaddrinfo = orig

    def test_check_url_bad_port_does_not_raise(self):
        self.assertIsNotNone(probe.check_url('http://example.com:99999999/')[1])
        self.assertIsNotNone(probe.check_url('http://[bad/')[1])


class Hardening(unittest.TestCase):
    def run_app(self, query):
        import asyncio
        sent = []

        async def send(m):
            sent.append(m)

        asyncio.run(dl.app({'type': 'http', 'query_string': query.encode()}, None, send))
        return sent

    def test_bad_range_never_calls_resolve(self):
        orig, orig_pub = dl.resolve, dl.public_http_url
        calls = []
        dl.resolve = lambda *a: calls.append(a) or ('https://example.com/v.mp4', {}, 't', 'mp4')
        dl.public_http_url = lambda u: True
        try:
            sent = self.run_app('url=https%3A%2F%2Fexample.com%2Fp&f=1&r=9-1')
            self.assertEqual(sent[0]['status'], 400)
            self.assertEqual(calls, [])
        finally:
            dl.resolve, dl.public_http_url = orig, orig_pub

    def test_missing_peer_info_refuses(self):
        class Resp:
            fp = object()  # no .raw._sock

            def close(self):
                pass

        orig = dl.OPENER
        class Op:
            def open(self, *a, **k):
                return Resp()
        dl.OPENER = Op()
        try:
            with self.assertRaises(PermissionError):
                dl.open_media('https://example.com/v', {})
        finally:
            dl.OPENER = orig

    def served_type(self, upstream):
        class Resp:
            status = 200

            def __init__(self):
                self.headers = {'Content-Type': upstream, 'Content-Length': '3'}
                self.done = False

            def read(self, n):
                if self.done:
                    return b''
                self.done = True
                return b'abc'

            def close(self):
                pass

        orig = (dl.resolve, dl.public_http_url, dl.open_media)
        dl.resolve = lambda *a: ('https://example.com/v', {}, 't', 'mp4')
        dl.public_http_url = lambda u: True
        dl.open_media = lambda m, h: Resp()
        try:
            sent = self.run_app('url=https%3A%2F%2Fexample.com%2Fp&f=1')
        finally:
            dl.resolve, dl.public_http_url, dl.open_media = orig
        return dict(sent[0]['headers'])[b'content-type'].decode()

    def test_content_type_allowlist(self):
        self.assertEqual(self.served_type('text/html; charset=utf-8'), 'application/octet-stream')
        self.assertEqual(self.served_type('image/svg+xml'), 'application/octet-stream')
        self.assertEqual(self.served_type('video/mp4'), 'video/mp4')
        self.assertEqual(self.served_type('audio/mp4'), 'audio/mp4')
        self.assertEqual(self.served_type('application/octet-stream'), 'application/octet-stream')


if __name__ == '__main__':
    unittest.main()
