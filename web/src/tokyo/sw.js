/* The service worker.
 *
 * Why: in Tokyo's subways mobile data drops between stations. With this worker the page, the map tiles
 * and glyphs you have looked at, today's (and, prefetched by offline.js, tomorrow's) timetable and the station boards
 * keep working with no network. Trains keep moving on their timetable positions (they are timetable positions anyway,
 * labelled Scheduled); live marks simply go away while offline.
 *
 * Where: /sw.js, scope '/', on the BUILT site only. web/build.mjs copies this file to dist/sw.js and stamps BUILD and
 * ASSETS (this build's /assets/* files); offline.js registers it after the page is ready. The dev server never
 * registers it. Unstamped (BUILD 'dev'), it finds the build's files itself by crawling '/' and the chunks' imports.
 *
 * Caches (same-origin only; behind HTTP basic auth the browser adds its cached credentials to these fetches):
 *   tk-app-v1    the page ('/'), manifest, icons, every /assets/* file of this build (and of the previous build, so a
 *                page still open on it can lazy-load its chunks): precached at install, then cache-first (hashed names)
 *   tk-data-v1   /data/tokyo/*: names with a content hash or ?h= (timetable buckets, index.json?h=, network-v1.json?h=)
 *                cache-first; pointers (*-latest.json) and packs that keep their name (codes, exits, elev, names)
 *                network-first with a 3 s timeout, then the cached copy. LRU, 28 MB (a whole weekday is 9.3 MB raw,
 *                a holiday 8.2 MB: today + tomorrow + the packs fit without evicting today's hours).
 *   tk-tiles-v1  /tiles/*: vector tiles + glyphs the user has viewed: cache-first (the set names are versioned), LRU 30 MB.
 *   tk-live-v1   /api/tokyo/live.json: network first; offline, a copy at most 60 s old, else {"off":true,"reason":
 *                "offline"} (live.js then shows timetable positions, as when the poller is off). Never older than 60 s.
 * Page loads ('/' and its hash routes): network first (navigation preload, 4 s), then the cached app. ONLY the app shell
 * of THIS build (index.html naming /assets/tokyo-<BUILD>.js) is ever stored as '/' and answers a load from the cache
 * (About -> LICENSES.txt was stored as '/' and opened offline instead of the app). Other documents
 * (LICENSES.txt, robots.txt) go to the network as they are and are never cached. A 5xx (Cloudflare 52x, nginx 502
 * during a flip) is never stored and never shown when the cached app is there. A 401 (the browser forgot the
 * basic-auth login) unregisters this worker and passes the 401 on, so the next load signs in natively.
 * Pages get {type: 'tk-net', online} when the network goes away or comes back (offline.js shows its note).
 *
 * KILL SWITCH: a sw.js stamped `self.__TK_SW_OFF__ = true;`
 * (TK_SW_OFF=1 at build time) is a worker that REMOVES ITSELF: every phone that
 * has any earlier version fetches /sw.js on its next page load (updateViaCache 'none', the vhost sends no-cache) or
 * within the 30 min / 24 h update checks, installs this one at once (skipWaiting), and on activate it deletes every
 * tk-* cache, tells the pages ({type: 'tk-sw-off'}: offline.js then stops registering for 24 h), unregisters, and
 * reloads only the pages it controls that are in the background (a page on screen keeps running; nothing is
 * intercepted any more; its next load comes straight from the network). It has no fetch handler, never claims pages,
 * and a page it reloads comes back uncontrolled, so it cannot loop. A later normal build brings the worker back.
 */
/* eslint-env serviceworker */

const BUILD = self.__TK_BUILD__ || 'dev';        // web/build.mjs stamps the build id here
const ASSETS = self.__TK_ASSETS__ || [];         // web/build.mjs stamps every /assets/* file of the build here
const OFF = self.__TK_SW_OFF__ === true;         // the kill switch (above); stamped, never set by hand here
const on = (type, fn) => { if (!OFF) self.addEventListener(type, fn); };   // the normal worker's handlers

if (OFF) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(selfDestruct()));
}

/** The kill switch: caches, word to the pages, unregister, background pages reload from the network. */
async function selfDestruct() {
  try { for (const k of await caches.keys()) if (k.startsWith('tk-')) await caches.delete(k); } catch { /* storage gone */ }
  let mine = [];
  try {
    mine = await self.clients.matchAll({ type: 'window' });   // the pages the old worker controlled (now this one)
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'tk-sw-off' });
  } catch { /* no pages */ }
  try { await self.registration.unregister(); } catch { /* already gone */ }
  for (const c of mine) if (c.visibilityState === 'hidden' && typeof c.navigate === 'function') c.navigate(c.url).catch(() => {});
}

const APP = 'tk-app-v1';
const DATA = 'tk-data-v1';
const TILES = 'tk-tiles-v1';
const LIVE = 'tk-live-v1';
const OURS = [APP, DATA, TILES, LIVE];
const MB = 1024 * 1024;
const CAP = { [DATA]: 28 * MB, [TILES]: 30 * MB };   // + the app shell (~3 MB a build, 2 builds kept) = about 64 MB at most
const TOUCH_MS = 6 * 3600 * 1000;                    // a cache hit older than this moves to the young end (LRU)
const PAGE_MS = 4000, DATA_MS = 3000, LIVE_MS = 6000, LIVE_MAX_AGE = 60 * 1000;
const META = '/__tk/build.json';                    // inside APP: { build, assets } of the build this worker holds
const NEXT = '/__tk/next.json';                     // inside APP: the list install found (crawl mode)
// not the two 512 px install icons (360 KB, every first visit): only the browser asks for them, when
// the site is added to the home screen, and it fetches them itself then
const SHELL = ['/', '/tokyo.webmanifest', '/icon.svg?v=4', '/favicon-32.png?v=4', '/apple-touch-icon.png?v=4',
  '/icon-192.png?v=4'];
const SHELL_PATHS = new Set(SHELL.map((u) => u.split('?')[0]).filter((p) => p !== '/'));   // '/' = page() only
const APP_PATHS = new Set(['/', '/index.html']);    // navigations the app shell answers (its routes are #hashes)
const HASHED = /[.-][0-9a-f]{10,}\.json$/;           // the timetable build bucket names: 0800-d5fa06d555.json
const M = { ignoreVary: true };

// ------------------------------------------------------------------ install / activate
on('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

on('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tk-') && !OURS.includes(k)) await caches.delete(k);
    try { await self.registration.navigationPreload?.enable(); } catch { /* not supported */ }
    await pruneAssets();
    await dropBadShell();
    await self.clients.claim();
  })());
});

async function precache() {
  const c = await caches.open(APP);
  const list = ASSETS.length ? ASSETS : await crawl();
  if (!ASSETS.length) await c.put(NEXT, json({ assets: list }));
  // the page itself revalidates; hashed files come from the HTTP cache the first load just filled (no new bytes)
  await Promise.all([...SHELL, ...list].map(async (u) => {
    try {
      if (u.startsWith('/assets/') && await c.match(u, M)) return;
      const res = await fetch(u, { cache: u.startsWith('/assets/') ? 'default' : 'no-cache' });
      if (u === '/') await keepShell(c, res);
      else if (res.ok && res.type === 'basic') await c.put(u, res);
    } catch { /* offline during install: runtime caching fills it later */ }
  }));
}

/** Unstamped build: '/' -> its stylesheet, scripts and modulepreloads -> every chunk and asset they import. */
async function crawl() {
  const seen = new Set();
  try {
    const html = await (await fetch('/', { cache: 'no-cache' })).text();
    const queue = [...html.matchAll(/(?:href|src)="(\/assets\/[^"?#]+)"/g)].map((m) => m[1]);
    while (queue.length && seen.size < 500) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      seen.add(u);
      if (!/\.m?js$/.test(u)) continue;
      const res = await fetch(u);
      if (!res.ok) continue;
      const js = await res.text();
      for (const m of js.matchAll(/["'`](?:\.\/|\/assets\/)((?:lib|tokyo|chunk|asset)-[\w.-]+?\.(?:m?js|css|webp|png|jpe?g|svg|glb|bin))["'`]/g)) queue.push(`/assets/${m[1]}`);
    }
  } catch { /* offline: nothing to crawl */ }
  return [...seen];
}

/** Keep this build's /assets/* and the previous build's; drop older ones. */
async function pruneAssets() {
  const c = await caches.open(APP);
  let cur = ASSETS;
  let id = BUILD;
  if (!cur.length) {
    const next = await readJSON(c, NEXT);
    cur = next?.assets || [];
    id = `crawl-${hash(cur.join('\n'))}`;
  }
  if (!cur.length) return;
  const prev = await readJSON(c, META);
  if (prev?.build === id) return;
  const keep = new Set([...cur, ...(prev?.assets || [])]);
  for (const r of await c.keys()) {
    const p = new URL(r.url).pathname;
    if (p.startsWith('/assets/') && !keep.has(p)) await c.delete(r);
  }
  await c.put(META, json({ build: id, assets: cur, at: Date.now() }));
}

// ------------------------------------------------------------------ fetch
on('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.headers.has('range')) return;
  const p = url.pathname;
  if (req.mode === 'navigate') return event.respondWith(page(event));
  if (p.startsWith('/assets/')) return event.respondWith(cacheFirst(event, APP));
  if (p.startsWith('/data/tokyo/')) return event.respondWith(HASHED.test(p) || url.searchParams.has('h') ? cacheFirst(event, DATA) : networkFirst(event, DATA, DATA_MS));
  if (p.startsWith('/tiles/')) return event.respondWith(cacheFirst(event, TILES));
  if (p === '/api/tokyo/live.json') return event.respondWith(live(event));
  if (SHELL_PATHS.has(p) || p.startsWith('/logos/')) return event.respondWith(networkFirst(event, APP, DATA_MS));   // logos: kept for offline once seen
  return undefined;   // anything else: the browser fetches it as usual
});

async function page(event) {
  const req = event.request;
  const preload = event.preloadResponse ? Promise.resolve(event.preloadResponse).catch(() => null) : Promise.resolve(null);
  event.waitUntil(preload);
  const fromNet = preload.then((r) => r || fetch(req));
  if (!APP_PATHS.has(new URL(req.url).pathname)) {
    // another document (About -> LICENSES.txt, robots.txt): the network as it is, never cached, never the app
    return fromNet.then(async (res) => { if (res.status === 401) await self.registration.unregister(); return res; })
      .catch(() => Response.error());
  }
  const c = await caches.open(APP);
  let bad = null;   // the origin's own 5xx page: shown only when no cached app exists
  const net = fromNet.then(async (res) => {
    if (res.status === 401) { await self.registration.unregister(); return res; }   // signed out: sign in natively
    if (res.status >= 500) { bad = res; throw new Error(`HTTP ${res.status}`); }      // origin down: the cached app
    event.waitUntil(keepShell(c, res));
    if (res.ok) note(true);
    return res;
  });
  if (!self.navigator.onLine) {
    const hit = await cachedShell(c);
    if (hit) { net.catch(() => {}); note(false); return hit; }
  }
  try {
    return await within(net, PAGE_MS);
  } catch {
    const hit = await cachedShell(c);
    if (hit) { net.catch(() => {}); note(false); return hit; }
    return net.catch(() => bad || Response.error());   // nothing cached yet: the origin's page or the browser's own error
  }
}

/** Store `res` as '/' only when it is the app shell of THIS build (W3, never another document, never an error). */
function keepShell(c, res) {
  if (!res || !res.ok || res.type !== 'basic' || res.redirected || !isHtml(res)) return Promise.resolve();
  const look = res.clone(), keep = res.clone();   // cloned now: the page reads `res` itself
  return look.text().then((t) => (shellOf(t, true) ? c.put('/', keep) : undefined)).catch(() => {});
}
/** index.html of this build names its entry /assets/tokyo-<BUILD>.js (web/build.mjs); unstamped or `any`: any build's. */
function shellOf(text, own = false) {
  if (typeof text !== 'string') return false;
  return own && BUILD !== 'dev' ? text.includes(`/assets/tokyo-${BUILD}.js`) : /\/assets\/tokyo-[\w-]+\.js/.test(text);
}
const isHtml = (res) => /text\/html/i.test(res.headers.get('content-type') || '');
/** The cached app ('/'), only if it is an HTML app shell. */
async function cachedShell(c) {
  const hit = await c.match('/', M);
  return hit && isHtml(hit) ? hit : null;
}
/** On activate: a '/' that is not an app shell (an earlier worker stored LICENSES.txt or an error page there) goes. */
async function dropBadShell() {
  try {
    const c = await caches.open(APP);
    const hit = await c.match('/', M);
    if (hit && !(hit.status === 200 && isHtml(hit) && shellOf(await hit.clone().text()))) await c.delete('/', M);
  } catch { /* storage gone */ }
}

async function cacheFirst(event, name) {
  const req = event.request;
  const c = await caches.open(name);
  const hit = await c.match(req, M);
  if (hit) {
    const t = +hit.headers.get('x-tk-t') || 0;
    if (CAP[name] && t && Date.now() - t > TOUCH_MS) event.waitUntil(store(c, name, req, hit.clone()));
    return hit;
  }
  try {
    const res = await fetch(req);
    if ((res.ok || res.status === 204) && res.type === 'basic') event.waitUntil(store(c, name, req, res.clone()));
    if (res.ok || res.status === 204) note(true);
    return res;
  } catch (e) {
    if (!aborted(e, req)) note(false);
    return Response.error();
  }
}

async function networkFirst(event, name, ms) {
  const req = event.request;
  const c = await caches.open(name);
  const net = fetch(req).then((res) => {
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (res.ok && res.type === 'basic') event.waitUntil(store(c, name, req, res.clone()));
    if (res.ok) note(true);
    return res;
  });
  event.waitUntil(net.catch(() => {}));
  if (!self.navigator.onLine) {
    const hit = await c.match(req, M);
    if (hit) { note(false); return hit; }
  }
  try {
    return await within(net, ms);
  } catch (e) {
    const hit = await c.match(req, M);
    if (hit) { if (!aborted(e, req)) note(false); return hit; }
    try { return await net; } catch (e2) { if (!aborted(e2, req)) note(false); return Response.error(); }
  }
}

/** live.json: never older than 60 s from here; offline or a 5xx = a copy <= 60 s old, else {off, reason: 'offline'}
 * (live.js takes that as a blip and polls again soon; Scheduled positions meanwhile). A 5xx is never stored. */
async function live(event) {
  const req = event.request;
  const c = await caches.open(LIVE);
  try {
    const res = await within(fetch(req), LIVE_MS);
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);   // the poller restarting / origin down: as offline
    if (res.ok && res.type === 'basic') {
      const body = await res.clone().arrayBuffer();
      const h = new Headers(res.headers);
      h.delete('content-encoding'); h.delete('content-length'); h.set('x-tk-t', String(Date.now()));
      event.waitUntil(c.put('/api/tokyo/live.json', new Response(body, { status: 200, headers: h })).catch(() => {}));
      note(true);
    }
    return res;
  } catch {
    const hit = await c.match('/api/tokyo/live.json', M);
    if (hit && Date.now() - (+hit.headers.get('x-tk-t') || 0) <= LIVE_MAX_AGE) return hit;
    if (hit) event.waitUntil(c.delete('/api/tokyo/live.json'));
    note(false);
    return new Response(JSON.stringify({ off: true, reason: 'offline' }), {
      status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-tk-sw': 'offline' },
    });
  }
}

// ------------------------------------------------------------------ storage with an LRU cap (DATA, the tile server)
const size = {};      // cache name -> bytes (measured once per worker life, then kept up to date)
const pruning = {};

async function store(c, name, req, res) {
  try {
    const body = res.status === 204 ? null : await res.arrayBuffer();
    const n = body ? body.byteLength : 0;
    const h = new Headers(res.headers);
    h.delete('content-encoding'); h.delete('content-length');   // the body is already decoded
    h.set('x-tk-t', String(Date.now()));
    h.set('x-tk-n', String(n));
    if (CAP[name] && size[name] == null) size[name] = await measure(c);
    const old = CAP[name] ? await c.match(req, M) : null;
    await c.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers: h }));
    if (!CAP[name]) return;
    size[name] += n - (old ? +old.headers.get('x-tk-n') || 0 : 0);
    if (size[name] > CAP[name]) await prune(c, name);
  } catch { /* quota or a broken body: not cached, nothing else breaks */ }
}

async function measure(c) {
  let s = 0;
  for (const r of await c.matchAll(undefined, M)) s += +r.headers.get('x-tk-n') || 0;
  return s;
}

/** Oldest first (Cache keys keep insertion order; a touch re-inserts) until 80 % of the cap. */
async function prune(c, name) {
  if (pruning[name]) return;
  pruning[name] = true;
  try {
    let s = size[name];
    for (const k of await c.keys()) {
      if (s <= CAP[name] * 0.8) break;
      const r = await c.match(k, M);
      s -= r ? +r.headers.get('x-tk-n') || 0 : 0;
      await c.delete(k, M);
    }
    size[name] = s;
  } finally { pruning[name] = false; }
}

// ------------------------------------------------------------------ messages (pages <-> worker)
let lastNote = null;
async function note(online) {
  if (online === lastNote) return;
  lastNote = online;
  for (const cl of await self.clients.matchAll({ type: 'window' })) cl.postMessage({ type: 'tk-net', online });
}

on('message', (event) => {
  const d = event.data || {};
  if (d.type === 'tk-stats') {
    event.waitUntil((async () => {
      const out = { type: 'tk-stats', build: BUILD, caches: {} };
      for (const k of OURS) {
        const c = await caches.open(k);
        const keys = await c.keys();
        out.caches[k] = { entries: keys.length, bytes: CAP[k] ? await measure(c) : null };
      }
      event.source?.postMessage(out);
    })());
  }
});

// ------------------------------------------------------------------ helpers
function within(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const aborted = (e, req) => e?.name === 'AbortError' || req.signal?.aborted;
const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
async function readJSON(c, key) { try { const r = await c.match(key, M); return r ? await r.json() : null; } catch { return null; } }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
