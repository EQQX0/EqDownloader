"""Writes the SHA-256 values and version of a release into site/index.html, matched by file name.

Usage: python scripts/sync-site-hashes.py v0.1.27 [--check]
--check changes nothing and exits 1 when the site disagrees with the release's SHA256SUMS.txt.
"""
import re
import subprocess
import sys

tag = sys.argv[1]
check = '--check' in sys.argv
sums = subprocess.run(
    ['gh', 'release', 'download', tag, '-R', 'EQQX0/EqDownloader', '-p', 'SHA256SUMS.txt', '-O', '-'],
    capture_output=True, text=True, check=True).stdout
hashes = {}
for line in sums.splitlines():
    m = re.match(r'^([0-9a-f]{64})\s+\*?(\S+)\s*$', line)
    if m:
        hashes[m.group(2)] = m.group(1)
for name in ('EqDownload.exe', 'EqDownload.apk'):
    if name not in hashes:
        sys.exit(f'{name} missing from SHA256SUMS.txt')

path = 'site/index.html'
html = open(path, encoding='utf-8', newline='').read()
new = html
for name, digest in hashes.items():
    new = re.sub(rf'({re.escape(name)}<br><code>)[0-9a-f]{{64}}(</code>)', rf'\g<1>{digest}\g<2>', new)
new = re.sub(r'releases/download/v[\d.]+/', f'releases/download/{tag}/', new)
new = re.sub(r'Version [\d.]+</h3>', f'Version {tag[1:]}</h3>', new)
if check:
    sys.exit(0 if new == html else 'site/index.html disagrees with ' + tag)
open(path, 'w', encoding='utf-8', newline='').write(new)
print('site/index.html now matches', tag)
