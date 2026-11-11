'use strict';
/* Service worker — ilovani telefonga o'rnatish (PWA) uchun.
   Strategiya: avval tarmoq, faqat internet bo'lmasa — saqlangan nusxa.
   Shunday qilib yangi versiya chiqqanda hech kim eski kodda qolib ketmaydi. */
const CACHE = 'mafia-v1';
const SHELL = [
  '/', '/style.css', '/client.js', '/sound.js', '/voice.js', '/narrator.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Google Fonts va boshqalar — brauzerning o'zi
  if (url.pathname.startsWith('/socket.io')) return;      // real vaqt ulanishi — hech qachon keshlanmaydi
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && url.search === '') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});
