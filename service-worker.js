/* RunLab — service worker : rend l'app installable et utilisable hors-ligne. */
const CACHE = "runlab-v3";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "charts.js",
  "garmin-sync.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  // ne jamais toucher aux appels externes (proxy Garmin) : toujours le réseau
  if (new URL(req.url).origin !== self.location.origin) return;
  // réseau d'abord pour les données, cache d'abord pour l'app
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
