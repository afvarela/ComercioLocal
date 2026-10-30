const CACHE = "comercio-local-20261029092614";
const PRODUCT_IMAGES = [
  "aguacate.svg", "arveja.jpg", "banano.svg", "cebolla-cabezona.jpg",
  "cebolla-larga.jpg", "cilantro.svg", "fresa.svg", "habichuela.jpg",
  "mango.svg", "manzana.svg", "papa.jpg", "pepino.jpg", "pera.svg",
  "pimenton.jpg", "platano-maduro.svg", "platano.svg", "repollo.jpg",
  "tomate.jpg", "zanahoria.jpg",
].map((name) => `/images/${name}`);
const SHELL = ["/", "/index.html", "/app.js", "/style.css", "/favicon.svg", "/manifest.webmanifest", ...PRODUCT_IMAGES];
const NETWORK_FIRST = ["/app.js", "/style.css", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map(async (url) => {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (!response.ok) throw new Error(`No se pudo guardar ${url}`);
        await cache.put(url, response);
      })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || ["/receipt", "/receipt.txt", "/quote.pdf", "/dispatch", "/dispatch.txt", "/labels-preview"].includes(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put("/", copy));
        return response;
      }).catch(() => caches.match("/").then((cached) => cached || caches.match("/index.html"))),
    );
    return;
  }

  const cacheKey = url.pathname;
  if (NETWORK_FIRST.includes(cacheKey)) {
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
        return response;
      }).catch(() => caches.match(cacheKey)),
    );
    return;
  }
  event.respondWith(
    caches.match(cacheKey).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
        }
        return response;
      });
    }),
  );
});
