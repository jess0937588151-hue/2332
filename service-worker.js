const CACHE_NAME = 'pos-v2124-cache';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/base.css',
  './styles/layout.css',
  './styles/pos.css',
  './styles/orders.css',
  './styles/reports.css',
  './styles/products.css',
  './styles/settings.css',
  './js/app.js',
  './js/core/store.js',
  './js/core/storage.js',
  './js/core/utils.js',
  './js/pages/pos-page.js',
  './js/pages/orders-page.js',
  './js/pages/reports-page.js',
  './js/pages/products-page.js',
  './js/pages/settings-page.js',
  './js/modules/cart-service.js',
  './js/modules/order-service.js',
  './js/modules/report-session.js',
  './js/modules/print-service.js',
  './js/modules/realtime-order-service.js',
  './js/modules/google-backup-service.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then((response) => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
