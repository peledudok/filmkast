const C = 'filmkast-v1';
const IMGC = 'filmkast-img-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C && k !== IMGC).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.hostname === 'api.themoviedb.org') return;
  if (u.hostname === 'image.tmdb.org') {
    e.respondWith(caches.open(IMGC).then(async c => {
      const hit = await c.match(r);
      if (hit) return hit;
      try { const res = await fetch(r); c.put(r, res.clone()); return res; } catch (err) { return Response.error(); }
    }));
    return;
  }
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match('index.html'))));
  }
});
