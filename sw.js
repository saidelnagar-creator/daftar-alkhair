// build: f267c1096c2a
// Service Worker: يخزّن كل أصول التطبيق ليعمل أوفلاين بالكامل.
// لا يلمس IndexedDB إطلاقاً — تحديث الكود لا يمس البيانات.
// التحديث: عامل جديد يُثبَّت في الخلفية وينتظر؛ الواجهة تعرض «تحديث الآن» فترسل SKIP_WAITING.
importScripts('./sw-assets.js');

const PREFIX = 'daftar-alkhair-';
const CACHE = `${PREFIX}${self.__ASSETS_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' يتجاوز كاش HTTP حتى لا نخزّن نسخاً قديمة
      await Promise.all(self.__ASSETS.map((url) => fetch(new Request(url, { cache: 'reload' })).then((res) => (res.ok ? cache.put(url, res) : Promise.reject(new Error(`${url}: ${res.status}`))))));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // الكاش أولاً (التطبيق كله مخزَّن)؛ تجاهل الاستعلامات مثل ?source=pwa
      const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch {
        return req.mode === 'navigate' ? (await cache.match('./index.html')) || Response.error() : Response.error();
      }
    })(),
  );
});
