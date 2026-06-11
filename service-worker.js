const CACHE_NAME = 'axiotune-v4';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style_v3.css',
    '/app_v3.js',
    '/manifest.json',
    '/logo.png',
    '/loading_logo.png',
    '/cursor.png',
    '/cursor.svg',
    '/cursor_transparent.png',
    '/macos-bg.jpg',
    '/macos-bg2.jpg',
    '/default_cover.jpg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only intercept basic static assets, bypass API calls for offline fallback
    if (event.request.url.includes('/api/')) {
        return; 
    }
    
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).catch(() => {
                // If network fails (offline) and not in cache, fallback to index.html if navigating
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});
