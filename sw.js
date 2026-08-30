/* ゲーム棚の見張り番。
   殻（HTML・JS・台帳・箱絵）だけを控える。ROM は play.html が別の棚（roms-v1）に置く。

   GitHub Pages は cache-control: max-age=600 を返す。素の fetch はブラウザの控えを掴むので、
   ここでは必ず no-cache を付けて取りに行く。公開しただけで直ったことにしない。 */
const SHELL = 'pg-shell-v1';
const FILES = [
  './', './index.html', './app.js?v=21', './play.html',
  './core/pcloud.js?v=1', './core/shelf.css?v=1',
  './np2/emnp21kai_sdl2_jspi.js?v=2', './np2/emnp21kai_sdl2_jspi.wasm',
  './games.json?v=1', './pc98.json?v=1', './play98.html',
  './manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.allSettled(FILES.map(async f => {
      const r = await fetch(f, { cache: 'no-cache' });
      if (r.ok) await c.put(f, r);
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('pg-shell-') && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  /* 箱絵は数が多い。取れたそばから控える。 */
  const isCover = u.pathname.includes('/covers/');
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const net = await fetch(e.request, { cache: 'no-cache' });
      if (net.ok) c.put(e.request, net.clone());
      return net;
    } catch (err) {
      const hit = await c.match(e.request) || await c.match('./index.html');
      if (hit) return hit;
      throw err;
    }
  })());
});
