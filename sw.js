// Service worker mínimo: guarda só os arquivos do app (rede primeiro, cache como reserva offline).
// Nunca guarda respostas das exchanges: dado de funding velho é pior que nenhum.
var CACHE = 'fd-shell-v88';
var SHELL = ['./', 'index.html', 'core.js', 'mining.js', 'copilot.js', 'radar.js', 'insights.js', 'app.js', 'manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname.indexOf('/data/') >= 0) return;
  // no-cache: confere com o servidor a cada abertura (evita misturar arquivo novo com arquivo velho do cache HTTP).
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) {
    if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
});
