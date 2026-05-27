// Basic Service Worker for PWA installation
const CACHE_NAME = 'streamify-cache-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Just pass through requests for now. 
    // Having a fetch listener is required by Chrome to trigger the install prompt.
    event.respondWith(fetch(event.request).catch(() => new Response('Offline')));
});
