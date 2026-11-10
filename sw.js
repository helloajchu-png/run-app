// Replaces the old /run-app/ service worker, drops its caches, then unregisters.
self.addEventListener('install', function (event) { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (key) { return caches.delete(key); }));
    await self.registration.unregister();
    var windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map(function (client) { return client.navigate(client.url); }));
  })());
});
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
