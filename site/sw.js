// Keeps the page shell so the installed web app opens offline. API calls and downloads always go to the network.
const CACHE = 'eq-shell-v2';
const SHELL = ['/', '/style.css', '/site.js', '/boot.js', '/logo.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Only the app shell is ever cached, keyed by path alone, so pasted links in ?url= or ?text= never reach Cache Storage.
  const inShell = SHELL.includes(url.pathname);
  const key = url.pathname;
  // Network first, so a new deploy shows up at once; the cache is the offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && inShell) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(inShell ? key : '/').then((hit) => hit || caches.match('/'))),
  );
});
