const CACHE_NAME = 'nova-v24';

const ASSETS = [
  './index.html',
  './manifest.json',
  './css/core.css',
  './css/themes.css',
  './css/orb.css',
  './css/components.css',
  './css/transitions.css',
  './js/core/app.js',
  './js/core/db.js',
  './js/core/state.js',
  './js/core/bus.js',
  './js/core/utils.js',
  './js/services/events.js',
  './js/services/memory.js',
  './js/services/context.js',
  './js/services/search.js',
  './js/ui/orb.js',
  './js/ui/theme.js',
  './js/ui/clock.js',
  './js/ui/particles.js',
  './js/ui/toast.js',
  './js/ui/install.js',
  './js/ui/diagnostics.js',
  './js/modules/notes.js',
  './js/modules/tasks.js',
  './js/modules/search-panel.js',
  './js/modules/memories-panel.js',
  './js/modules/timeline.js',
  './js/ui/awareness.js',
  './js/ui/reactor.js',
  './js/ui/mouse.js',
  './js/ui/hud.js',
  './js/ui/onboarding.js',
  './js/modules/conversation.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network first, fall back to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, toCache)).catch(() => {});
        return response;
      });
    })
  );
});
