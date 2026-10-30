/* Maison Atlas — service worker
   App shell + store data precached at install, CDN libraries and fonts cache-first, map tiles cached as
   they are viewed (or warmed by the "offline kit"), live APIs (FX, LLM, sync endpoint) never cached.
   Bump VERSION whenever a precached file changes. */
const VERSION = "atlas-2026-10-30";
const SHELL = `shell-${VERSION}`, LIBS = "libs-v1", TILES = "tiles-v1";
const MAX_TILES = 4000;
const CORE = ["./", "index.html", "perfumeries.js", "intelligence.js", "ai_assistant.js", "modules.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
const CDN = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
  "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.3/leaflet-maplibre-gl.js",
  "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js",
  "https://unpkg.com/tabulator-tables@6.3.0/dist/css/tabulator_simple.min.css",
  "https://unpkg.com/tabulator-tables@6.3.0/dist/js/tabulator.min.js",
  "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&display=swap",
];
const LIVE = /(^|\.)(frankfurter\.dev|anthropic\.com|openai\.com|workers\.dev)$/;
const LIB_HOSTS = new Set(["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"]);
const TILE_HOSTS = /(^|\.)(tiles\.openfreemap\.org|basemaps\.cartocdn\.com|tile\.openstreetmap\.org)$/;
const isTile = u => /\/\d+\/\d+\/\d+(@2x)?\.(pbf|png|jpg|webp|mvt)$/.test(u.pathname);

// CORS fetch keeps responses readable (no opaque padding against the quota); fall back to the original request
async function fetchCors(req) {
  const url = typeof req === "string" ? req : req.url;
  try { return await fetch(new Request(url, { mode: "cors", credentials: "omit" })); }
  catch (e) { if (typeof req === "string") throw e; return fetch(req); }
}
async function put(cacheName, key, res) {
  if (!res || !(res.ok || res.type === "opaque")) return res;
  const c = await caches.open(cacheName);
  await c.put(key, res.clone());
  if (cacheName === TILES && Math.random() < .02) trim();
  return res;
}
async function trim() {
  const c = await caches.open(TILES), keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(CORE);
    const libs = await caches.open(LIBS);
    await Promise.all(CDN.map(async u => { if (!(await libs.match(u))) { try { await put(LIBS, u, await fetchCors(u)); } catch (err) { /* offline install: runtime caching fills it */ } } }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, LIBS, TILES]);
    await Promise.all((await caches.keys()).filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (LIVE.test(url.hostname) || url.protocol !== "https:" && url.origin !== location.origin) return;

  // Pages: network first (fresh deploys), cached shell within 3 s or when offline
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cached = caches.match("index.html", { cacheName: SHELL });
      try {
        const net = fetch(req).then(r => put(SHELL, "index.html", r));
        return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 3000))]);
      } catch (err) { return (await cached) || fetch(req); }
    })());
    return;
  }
  // Own files: stale-while-revalidate
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => put(SHELL, req, r)).catch(() => null);
      if (cached) { e.waitUntil(net); return cached; }
      return (await net) || new Response("Offline", { status: 503 });
    })());
    return;
  }
  // Versioned libraries and font files: cache first
  if (LIB_HOSTS.has(url.hostname)) {
    e.respondWith(caches.match(req.url).then(c => c || fetchCors(req).then(r => put(LIBS, req.url, r))));
    return;
  }
  // Map tiles: cache first; styles / TileJSON / glyphs / sprites: stale-while-revalidate
  if (TILE_HOSTS.test(url.hostname)) {
    if (isTile(url)) {
      e.respondWith(caches.match(req.url, { cacheName: TILES }).then(c => c || fetchCors(req).then(r => put(TILES, req.url, r))));
    } else {
      e.respondWith((async () => {
        const cached = await caches.match(req.url, { cacheName: LIBS });
        const net = fetchCors(req).then(r => put(LIBS, req.url, r)).catch(() => null);
        if (cached) { e.waitUntil(net); return cached; }
        return (await net) || new Response("", { status: 504 });
      })());
    }
  }
});

// "Prepare offline kit": refresh shell, data and libraries, then warm the tiles the page asked for
self.addEventListener("message", e => {
  if (e.data?.type !== "warm") return;
  const port = e.ports[0];
  e.waitUntil((async () => {
    let ok = 0, failed = 0;
    const own = u => new URL(u, self.registration.scope).href;
    const jobs = [...[...CORE, "perfumeries.json"].map(u => [SHELL, own(u)]), ...CDN.map(u => [LIBS, u]),
      ...(e.data.urls || []).slice(0, 1500).map(u => [TILES, u])];
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const [cache, u] = jobs[i++];
        try {
          if (cache === TILES && await caches.match(u, { cacheName: TILES })) { ok++; continue; }
          const r = await fetchCors(u);
          if (r.ok) { await put(cache, u, r); ok++; } else failed++;
        } catch (err) { failed++; }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    trim();
    port?.postMessage({ ok, failed });
  })());
});
