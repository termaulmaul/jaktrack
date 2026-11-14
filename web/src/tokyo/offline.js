// Offline support in the page. In the subway mobile data drops between stations; sw.js keeps the page, the tiles you
// have seen and the timetable on the phone.
//
//   initOffline({ t, lang, onLang, ready, calendar, map, register }) once, from page.js at boot. It
//   1. registers /sw.js (only when `register`: the BUILT site; the dev server has no /sw.js) after `ready` (map +
//      first trains) and an idle moment, so the worker's precache never competes with the first load;
//   2. warms the worker's cache once it controls the page: everything the first load fetched before the worker
//      existed (timetable buckets, network pack, pointers from Resource Timing; the map tiles of the current view and
//      the glyphs, from the style) is asked again through the worker. These come from the HTTP cache (immutable or a
//      304), so it costs almost no bytes, and the very first visit already works underground;
//   3. shows a calm note "Offline · timetable view" while the network is gone (navigator.onLine false, or the worker
//      saying a fetch failed and it answered from its cache) and hides it when the network is back;
//   4. once per service day, at idle on a good connection: the rest of TODAY's timetable (the light loading, the page
//      loads only the hours it shows, so these keep a subway gap later today working), then tomorrow's timetable
//      (index + hourly buckets) and the exits / elev packs go through the worker into its cache, so tomorrow's first
//      ride underground still has trains and boards (a whole day ~1.3-1.5 MB on the wire; fetched, never parsed here;
//      skipped with Save-Data or on 2G/3G).
//   5. kill switch: when sw.js's switched-off build says {type: 'tk-sw-off'} (it has removed itself), or the page is
//      opened with ?nosw (removes the worker + its tk-* caches by hand), it does not register again for 24 h.
// Returns { online(), refresh(), stats(), warmed } (stats asks the worker for its cache sizes; warmed resolves after
// step 2; QA waits on it before going offline).
// No dependencies; strings come from the page's t() (i18n.js 'offline.*'), English if a key is missing.

const EN = { 'offline.note': 'Offline · timetable view', 'offline.aria': 'No connection: the map, trains and boards run from the timetable saved on this phone' };
const CSS = `
.tk-offline{position:absolute;z-index:30;left:calc(14px + var(--safe-l, 0px));top:calc(var(--safe-t, 0px) + 108px);display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 10px;border-radius:999px;background:var(--realm-card, #fff);box-shadow:var(--realm-shadow, 0 1px 3px rgba(20,20,30,.14));font:600 12.5px/1 var(--font, system-ui, sans-serif);color:var(--text2, #4a4a52);white-space:nowrap;pointer-events:none}
.tk-offline[hidden]{display:none}
.tk-offline svg{flex:none;width:15px;height:15px;fill:currentColor}
.tk-app[data-loading] .tk-offline{top:calc(var(--safe-t, 0px) + 16px)}
@media (min-width:900px){.tk-offline{left:50%;transform:translateX(-50%);top:calc(var(--safe-t, 0px) + 14px)}}
`;

const DAY = 86400000;
const PREFETCH_KEY = 'tokyo.offline.prefetched';
const TODAY_KEY = 'tokyo.offline.today';   // today's buckets pulled through the worker (once per service day)
const UPDATE_EVERY = 30 * 60 * 1000;
// sw.js's kill switch said {type: 'tk-sw-off'} (or the page was opened with ?nosw): no registration for a day, so a
// switched-off worker is not installed and removed again on every load; a normal build brings it back after that
const SW_OFF_KEY = 'tokyo.sw.off';

export function initOffline({
  t = null, lang = null, onLang = null, ready = Promise.resolve(), calendar = null, map = null, register = false,
  swUrl = '/sw.js', data = '/data/tokyo', root = typeof document !== 'undefined' ? document.getElementById('app') || document.body : null,
} = {}) {
  if (typeof window === 'undefined' || !root) return null;
  try { performance.setResourceTimingBufferSize(1500); } catch { /* fine */ }
  const tr = (k) => { const s = typeof t === 'function' ? t(k) : null; return s && s !== k ? s : EN[k]; };
  let swOnline = true;                       // the worker's last word (a fetch failed -> false; one worked -> true)
  let swOff = false;                         // the worker's kill switch ran here lately (no registration, no warm-up)
  let el = null;

  const online = () => navigator.onLine !== false && swOnline;
  function paint() {
    const off = !online();
    if (!el && !off) return;
    if (!el) {
      if (!document.getElementById('tk-offline-css')) {
        const st = document.createElement('style');
        st.id = 'tk-offline-css';
        st.textContent = CSS;
        document.head.append(st);
      }
      el = document.createElement('div');
      el.className = 'tk-offline';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<svg aria-hidden="true" focusable="false"><use href="#i-offline"/></svg><span></span>';
      root.append(el);
    }
    el.querySelector('span').textContent = tr('offline.note');
    el.setAttribute('aria-label', tr('offline.aria'));
    el.title = tr('offline.aria');
    el.hidden = !off;
    root.toggleAttribute('data-offline', off);
  }

  addEventListener('online', () => { swOnline = true; paint(); });
  addEventListener('offline', paint);
  if (typeof onLang === 'function') { try { onLang(() => paint()); } catch { /* fine */ } }
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  if (sw) {
    sw.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'tk-net') { swOnline = !!d.online; paint(); }
      if (d.type === 'tk-sw-off') { swOff = true; markSwOff(); }
    });
    try { sw.startMessages(); } catch { /* older engines start on their own */ }
  }
  paint();

  // ---------------------------------------------------------------- the worker (built site only)
  let reg = null;
  let warmedDone;
  const warmed = new Promise((r) => { warmedDone = r; });
  // ?nosw: remove the worker + its caches from this phone by hand (support / QA), then no registration for a day. The
  // worker still controls this page and would fill its caches again, so the page loads once more without it.
  if (sw && /[?&]nosw(=|&|$)/.test(location.search)) {
    markSwOff();
    removeWorker(sw).then(() => {
      if (!sw.controller) return;
      const u = new URL(location.href);
      u.searchParams.delete('nosw');
      location.replace(u.href);
    }).catch(() => {});
  }
  swOff = swOffRecently();
  if (swOff && sw && !sw.controller) dropCaches().catch(() => {});   // what a switched-off worker left behind
  if (register && sw && window.isSecureContext !== false && !swOff) {
    Promise.resolve(ready).catch(() => null).then(() => idle(4000)).then(async () => {
      let had = null;
      try { had = await sw.getRegistration('/'); } catch { /* fine */ }
      try {
        reg = await sw.register(swUrl, { scope: '/', updateViaCache: 'none' });
      } catch (e) { console.warn('[tokyo] service worker not registered', e?.message || e); return; }
      // a worker from an earlier load: check /sw.js now (~5 KB) rather than when the browser finds a quiet second
      // (Chrome defers its own check while requests flow); a new build or the kill switch then lands on this load
      if (had?.active) reg.update().catch(() => {});
      // a phone keeps the app open for days: look for a new build when it comes back to the front
      let checked = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden || !navigator.onLine || Date.now() - checked < UPDATE_EVERY) return;
        checked = Date.now();
        reg.update().catch(() => {});
      });
      await controlled(sw);
      if (swOff) return;   // the kill switch answered: nothing to warm
      await idle(3000);
      await warm().catch(() => {});
      warmedDone(true);
      await prefetchToday().catch(() => {});   // at once (a ride underground can start any minute)
      await idle(15000);
      prefetchTomorrow().catch(() => {});
    }).finally(() => warmedDone(false));
  } else warmedDone(false);

  /** What the first load fetched before the worker controlled the page, asked again through it (HTTP-cache hits). */
  async function warm() {
    if (!sw?.controller) return;
    const urls = new Set();
    for (const e of performance.getEntriesByType('resource')) {
      let u;
      try { u = new URL(e.name); } catch { continue; }
      if (u.origin === location.origin && /^\/(data\/tokyo|tiles)\//.test(u.pathname)) urls.add(u.pathname + u.search);
    }
    const m = typeof map === 'function' ? map() : map;
    for (const u of viewTiles(m)) urls.add(u);
    for (const u of urls) await pull(u);
  }

  /** A service day's hourly buckets (index + files: the same URLs tt.js asks for, so the page finds them in the
   *  worker's cache), on a good connection only. Hashed names: the worker answers the ones it has from its cache. */
  async function pullDay(cal, date, ptr) {
    for (const name of cal.calendarFor(date) || []) {
      if (!ptr.cals[name]) continue;
      const idx = await getJSON(`${data}/${ptr.dir}/${name}/index.json?h=${ptr.hash}`);
      for (const b of idx?.buckets || []) { if (!navigator.onLine) return false; await pull(`${data}/${ptr.dir}/${name}/${b.file}`); }
    }
    return true;
  }
  const goodNet = () => { const c = navigator.connection; return !(c && (c.saveData || /(^|-)2g$|^3g$/.test(String(c.effectiveType || '')))); };

  /** the rest of TODAY's timetable through the worker into its cache, once per service day. The page
   *  itself now loads only the hours it shows (the hour on the clock first, more on demand), so without this a subway
   *  gap later today would leave the boards without their later trains; fetch only (no parsing on the main thread). */
  async function prefetchToday() {
    const cal = typeof calendar === 'function' ? calendar() : calendar;
    if (!cal?.serviceDate || !cal?.calendarFor || !sw?.controller || !navigator.onLine || !goodNet()) return;
    const ptr = await getJSON(`${data}/tt-latest.json`);
    const today = cal.serviceDate(Date.now());
    const stamp = `${today}:${ptr?.hash}`;
    let last = null;
    try { last = localStorage.getItem(TODAY_KEY); } catch { /* storage blocked: prefetch again next time */ }
    if (!ptr?.cals || last === stamp) return;
    if (!await pullDay(cal, today, ptr)) return;
    try { localStorage.setItem(TODAY_KEY, stamp); } catch { /* fine */ }
  }

  /** Tomorrow's timetable + the station packs, through the worker into its cache (once per service day). */
  async function prefetchTomorrow() {
    const cal = typeof calendar === 'function' ? calendar() : calendar;
    if (!cal?.serviceDate || !cal?.calendarFor || !sw?.controller || !navigator.onLine) return;
    if (!goodNet()) return;
    const ptr = await getJSON(`${data}/tt-latest.json`);
    const tomorrow = cal.serviceDate(Date.now() + DAY);
    const stamp = `${tomorrow}:${ptr?.hash}`;
    let last = null;
    try { last = localStorage.getItem(PREFETCH_KEY); } catch { /* storage blocked: prefetch again next time */ }
    if (!ptr?.cals || last === stamp) return;
    // the same URLs tt.js asks for, so the page finds them in the worker's cache tomorrow
    if (!await pullDay(cal, tomorrow, ptr)) return;
    // codes-v1.json is merged into the network pack: nothing to fetch for it
    for (const pack of ['exits', 'elev']) {
      const p = await getJSON(`${data}/${pack}-latest.json`).catch(() => null);
      if (p?.file) await pull(`${data}/${p.file}`);
    }
    try { localStorage.setItem(PREFETCH_KEY, stamp); } catch { /* fine */ }
  }

  return {
    online,
    refresh: paint,
    /** QA: the worker's cache sizes ({ build, caches: { name: { entries, bytes } } }), or null. */
    stats: () => new Promise((resolve) => {
      if (!sw?.controller) return resolve(null);
      const to = setTimeout(() => resolve(null), 4000);
      const on = (e) => { if (e.data?.type === 'tk-stats') { clearTimeout(to); sw.removeEventListener('message', on); resolve(e.data); } };
      sw.addEventListener('message', on);
      sw.controller.postMessage({ type: 'tk-stats' });
    }),
    prefetch: () => prefetchTomorrow(),
    warmed,
  };
}

/** The vector tiles MapLibre shows now (each source's covering zoom over the visible bounds) + the Latin glyph range
 * of each font stack, as the URLs MapLibre asks for (tile workers do not show up in the page's Resource Timing). */
export function viewTiles(map) {
  const out = [];
  try {
    if (!map?.getStyle || !map.getBounds) return out;
    const st = map.getStyle();
    const b = map.getBounds();
    const zf = Math.floor(map.getZoom());
    const lon2x = (lon, n) => Math.floor(((lon + 180) / 360) * n);
    const lat2y = (lat, n) => { const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
    for (const src of Object.values(st.sources || {})) {
      if (src.type !== 'vector' || !Array.isArray(src.tiles) || !src.tiles[0]) continue;
      if (zf < (src.minzoom ?? 0)) continue;
      // the covering zoom and the next one in (the opening camera can land on either side of a whole zoom)
      for (const z of new Set([Math.min(src.maxzoom ?? 14, zf), Math.min(src.maxzoom ?? 14, zf + 1)])) {
        const n = 2 ** z;
        const [x0, x1] = [lon2x(b.getWest(), n), lon2x(b.getEast(), n)];
        const [y0, y1] = [lat2y(b.getNorth(), n), lat2y(b.getSouth(), n)];
        for (let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) {
          if (out.length < 48) out.push(src.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y));
        }
      }
    }
    if (st.glyphs) {
      const stacks = new Set();
      const OPS = new Set(['get', 'literal', 'case', 'match', 'step', 'coalesce', 'concat', 'let', 'var', 'interpolate', 'to-string', 'string', 'array', 'format']);
      for (const l of st.layers || []) {
        let f = l.layout && l.layout['text-font'];
        if (Array.isArray(f) && f[0] === 'literal' && Array.isArray(f[1])) f = f[1];   // ['literal', ['Noto Sans Medium']]
        if (Array.isArray(f) && f.length && !OPS.has(f[0]) && f.every((x) => typeof x === 'string')) stacks.add(f.join(','));
      }
      for (const f of stacks) out.push(st.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', '0-255'));
    }
  } catch { /* a map without these: nothing to warm */ }
  return out.map((u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname + x.search : null; } catch { return null; } }).filter(Boolean);
}

function swOffRecently() {
  try { const at = +localStorage.getItem(SW_OFF_KEY) || 0; return at > 0 && Date.now() - at < DAY; } catch { return false; }
}
function markSwOff() {
  try { localStorage.setItem(SW_OFF_KEY, String(Date.now())); } catch { /* storage blocked: the worker removes itself again */ }
}
async function removeWorker(sw) {
  for (const r of await sw.getRegistrations()) await r.unregister();
  await dropCaches();
}
async function dropCaches() {
  if (typeof caches === 'undefined') return;
  for (const k of await caches.keys()) if (k.startsWith('tk-')) await caches.delete(k);
}
function idle(timeout) {
  return new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout }) : setTimeout(r, Math.min(timeout, 2000))));
}
function controlled(sw) {
  if (sw.controller) return Promise.resolve();
  return new Promise((r) => { sw.addEventListener('controllerchange', () => r(), { once: true }); setTimeout(r, 30000); });
}
async function getJSON(url) {
  const res = await fetch(url, { priority: 'low' });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
async function pull(url) {
  try { const res = await fetch(url, { priority: 'low' }); if (res.ok) await res.arrayBuffer(); } catch { /* offline again: next time */ }
}
