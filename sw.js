const CACHE_NAME = 'logic-arrows-v2';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    const accept = e.request.headers.get('accept') || '';
    const isPage = e.request.mode === 'navigate' || accept.includes('text/html') ||
        url.pathname.endsWith('index.html') || url.pathname.endsWith('/LogicArrows/');
    if (isPage) {
        // Сторінки: спочатку мережа (завжди свіжа версія), кеш — лише для офлайну
        e.respondWith(
            fetch(e.request).then(resp => {
                const copy = resp.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(() => {});
                return resp;
            }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
        );
    } else {
        // Статика: спочатку кеш
        e.respondWith(
            caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
                const copy = resp.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(() => {});
                return resp;
            }))
        );
    }
});
