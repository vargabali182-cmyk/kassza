// Kassza service worker: network first (always fresh when online), cache fallback (works fully offline).
const CACHE = 'kassza-v7';
const FILES = ['./', './index.html', './style.css', './js/core.js', './js/charts.js', './js/views.js', './js/forms.js', './js/importers.js', './js/insights.js', './js/advisor.js', './js/app.js',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Android share target: a CSV shared from the Revolut app (or any app) lands here
  if (e.request.method === 'POST' && new URL(e.request.url).pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('file');
        // keep the raw bytes: the file may be CSV or an Excel (.xlsx) statement
        const body = file && typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : new TextEncoder().encode(form.get('text') || '');
        const c = await caches.open('kassza-share');
        await c.put('shared-file', new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } }));
      } catch (err) { /* fall through to the app, which reports the missing file */ }
      return Response.redirect('./index.html?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
