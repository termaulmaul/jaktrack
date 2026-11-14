// Traffic cameras (CCTV) on the map: pins from the optional pack cctv-v1.json (data-build/cctv.mjs), a tap opens the
// camera sheet (#c=<id>). Off by default; page.js shows the button only when the pack was built.
//
//   const cctv = await mountCctv(map, { data: '/data/tokyo', before: 'tokyo-trains', font, open, onChange })
//   cctv.setOn(true)             pins on / off (plain MapLibre layers under the trains; clustered, hidden below zoom 9)
//   cctv.select(id | null)       ring + fly to the camera; null also stops any video in the sheet
//   cctv.view(id, { t, close })  the sheet's HTML
//   cctv.sources                 the pack's owners, for credits.js
//
// The owner's page is the main action. Video plays in the page only where the browser plays HLS by itself
// (Safari / iOS: no library here), straight from the owner's server: never proxied, never stored. Views without an HLS
// URL (YouTube, embed pages) are a link only.
const SRC = 'tk-cctv', PIN = 'tk-cctv-pin', CLUSTER = 'tk-cctv-cluster', COUNT = 'tk-cctv-count', SEL = 'tk-cctv-sel';
const LAYERS = [CLUSTER, COUNT, PIN, SEL];
const INK = '#0B5C7A';

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Does this browser play HLS without a library? (Safari / iOS, and Chromium builds that ship it.) */
export const nativeHls = () => { try { return !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'); } catch { return false; } };

export const CCTV_CSS = `
.tk-app[data-screen="cctv"] #search,.tk-app[data-screen="cctv"] .tk-sbar{display:none}
.tkc{padding:2px 0 8px;color:var(--text,#171717)}
.tkc .ph{margin:2px 0 6px}
.tkc-own{margin:0 0 12px;font:400 13px/18px var(--font);color:var(--text2,#6B6B70)}
.tkc .btn{display:flex;text-decoration:none;margin:0 0 12px}
.tkc-views{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.tkc-views button{min-height:44px;padding:0 14px;border-radius:22px;background:var(--panel,#F2F2F4);color:var(--text,#171717);font:600 14px/18px var(--font)}
.tkc-views button[aria-pressed="true"]{background:var(--primary,#171717);color:#fff}
.tkc-v{display:block;width:100%;aspect-ratio:16/9;background:#000;border-radius:12px;margin:0 0 10px}
.tkc-note{margin:0 0 10px;font:400 13px/18px var(--font);color:var(--text2,#6B6B70)}
.tkc-credit{margin:6px 0 0;font:400 13px/18px var(--font);color:var(--text3,#8A8996)}
`;

export async function mountCctv(map, opts = {}) {
  const o = { data: '/data/tokyo', before: 'tokyo-trains', font: null, open: null, onChange: null, ...opts };
  const res = await fetch(`${o.data}/cctv-v1.json`);
  if (!res.ok) throw new Error(`cctv-v1.json HTTP ${res.status}`);
  const pack = await res.json();
  const byId = new Map(pack.cams.map((c) => [c.id, c]));
  const hls = nativeHls();
  const failed = new Set();   // stream URLs that errored in this visit: the sheet says so instead of a dead player
  let on = false, selId = null, angle = 0;

  if (!document.getElementById('tokyo-cctv-css')) {
    const el = document.createElement('style'); el.id = 'tokyo-cctv-css'; el.textContent = CCTV_CSS; document.head.append(el);
  }

  function addLayers() {
    if (map.getSource(SRC)) return;
    const before = map.getLayer(o.before) ? o.before : undefined;
    map.addSource(SRC, {
      type: 'geojson', cluster: true, clusterMaxZoom: 13, clusterRadius: 46,
      data: { type: 'FeatureCollection', features: pack.cams.map((c) => ({ type: 'Feature', properties: { id: c.id }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) },
    });
    const stroke = { 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 };
    map.addLayer({ id: CLUSTER, type: 'circle', source: SRC, minzoom: 9, filter: ['has', 'point_count'],
      paint: { 'circle-color': INK, 'circle-opacity': 0.9, 'circle-radius': ['step', ['get', 'point_count'], 12, 10, 15, 40, 19], ...stroke } }, before);
    if (o.font) {
      map.addLayer({ id: COUNT, type: 'symbol', source: SRC, minzoom: 9, filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': o.font, 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': '#fff' } }, before);
    }
    map.addLayer({ id: PIN, type: 'circle', source: SRC, minzoom: 9, filter: ['!', ['has', 'point_count']],
      paint: { 'circle-color': INK, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 6, 17, 8], ...stroke } }, before);
    map.addLayer({ id: SEL, type: 'circle', source: SRC, filter: ['==', ['get', 'id'], ''],
      paint: { 'circle-color': '#fff', 'circle-radius': 11, 'circle-stroke-color': INK, 'circle-stroke-width': 4 } }, before);
  }
  // layer-scoped listeners: registered once, they outlive a style reload
  map.on('click', PIN, (e) => {
    if (e.originalEvent?.defaultPrevented) return;   // a station / train under the finger already took the tap
    const id = e.features?.[0]?.properties?.id;
    if (id) o.open?.('cctv', id);
  });
  map.on('click', CLUSTER, async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    try { map.easeTo({ center: f.geometry.coordinates, zoom: await map.getSource(SRC).getClusterExpansionZoom(f.properties.cluster_id) }); } catch { /* fine */ }
  });
  for (const id of [PIN, CLUSTER]) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
  map.on('styledata', () => { if (on && !map.getSource(SRC)) api.setOn(true); });   // the style was replaced: pins back in
  const stopVideo = () => { for (const v of document.querySelectorAll('.tkc-v')) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* fine */ } } };

  // the sheet's own controls: a camera angle; a stream that fails (media errors do not bubble: capture)
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-cctv-view]');
    if (!b) return;
    angle = Number(b.dataset.cctvView) || 0;
    o.onChange?.();
  });
  document.addEventListener('error', (e) => {
    const v = e.target;
    if (!v?.classList?.contains('tkc-v') || !v.getAttribute('src')) return;
    failed.add(v.getAttribute('src'));
    o.onChange?.();
  }, true);

  const api = {
    sources: pack.sources,
    get on() { return on; },
    get count() { return pack.cams.length; },
    has: (id) => byId.has(id),
    setOn(want) {
      on = !!want;
      if (on) addLayers();
      for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      if (!on) stopVideo();
      return on;
    },
    select(id) {
      const c = id ? byId.get(id) : null;
      if ((c?.id || null) !== selId) { angle = 0; stopVideo(); }
      selId = c?.id || null;
      if (map.getLayer(SEL)) map.setFilter(SEL, ['==', ['get', 'id'], selId || '']);
      if (c) map.easeTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), 15) });
    },
    view(id, ctx = {}) {
      const t = ctx.t, esc = escHtml;
      const close = ctx.close ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(t('close'))}"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button>` : '';
      const c = byId.get(id);
      if (!c) return `<section class="tkc"><div class="ph" data-drag><div class="rt"><h2>CCTV</h2></div>${close}</div><p class="tkc-note">${esc(t('cctv.gone'))}</p></section>`;
      const s = pack.sources[c.src];
      const cur = Math.min(angle, c.views.length - 1);
      const [, url, page] = c.views[cur];
      const views = c.views.length > 1
        ? `<div class="tkc-views" role="group" aria-label="${esc(t('cctv.views'))}">${c.views.map((v, i) => `<button type="button" data-cctv-view="${i}" aria-pressed="${i === cur}">${esc(v[0] || String(i + 1))}</button>`).join('')}</div>`
        : '';
      const player = !url ? `<p class="tkc-note">${esc(t('cctv.linkonly'))}</p>`
        : !hls ? `<p class="tkc-note">${esc(t('cctv.nohls'))}</p>`
          : failed.has(url) ? `<p class="tkc-note">${esc(t('cctv.fail'))}</p>`
            : `<video class="tkc-v" src="${esc(url)}" controls autoplay muted playsinline aria-label="${esc(c.name)}"></video>`;
      return `<section class="tkc" data-cctv="${esc(c.id)}">
  <div class="ph" data-drag><div class="rt"><h2>${esc(c.name)}</h2><p>${esc(c.sub)}</p></div>${close}</div>
  <p class="tkc-own">${esc(t('cctv.owner', { owner: s.owner }))} · ${esc(s.name)}</p>
  <a class="btn primary" href="${esc(page)}" target="_blank" rel="noopener noreferrer">${esc(t('cctv.open'))}</a>
  ${views}${player}
  <p class="tkc-credit">${esc(t('cctv.credit', { owner: s.owner }))}</p>
</section>`;
    },
  };
  return api;
}
