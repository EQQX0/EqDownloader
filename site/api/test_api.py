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


if __name__ == '__main__':
    unittest.main()
