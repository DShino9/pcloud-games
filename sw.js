/* ゲーム棚の見張り番。
   殻（HTML・JS・台帳・箱絵）だけを控える。ROM は play.html が別の棚（roms-v1）に置く。

   GitHub Pages は cache-control: max-age=600 を返す。素の fetch はブラウザの控えを掴むので、
   ここでは必ず no-cache を付けて取りに行く。公開しただけで直ったことにしない。 */
/* **控えの名前に版を入れる。** 名前が変わらないと、古い殻が居座って
   「直したのに変わらない」が起きる。公開のたびにここを上げる。 */
const SHELL = 'pg-shell-v24';
/* 先に控えるのは**必ずある物だけ**。版つきの名前を書くと、版を上げるたびに
   ここも直さねばならず、必ず忘れる（`app.js?v=21` が残っていた）。 */
const FILES = [
  './', './index.html', './play.html', './play98.html',
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
    /* 入れ替わったことを画面に知らせる。黙って古いまま見せない。 */
    for (const c of await self.clients.matchAll()) c.postMessage({ 版: SHELL });
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
