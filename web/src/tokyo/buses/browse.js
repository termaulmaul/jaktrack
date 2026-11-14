// TransJakarta routes and stops to browse: the service-type chips, the route list (Lines tab), the route sheet, the stop
// sheet and the search rows, as HTML strings like view.js. Everything is read from the bus pack (GTFS PT Transportasi
// Jakarta) and the timetable simulation (sim.js): headways and arrival times are ESTIMATES from the timetable, never live.
// A route is opened as bus "r:<route id>", a stop as "s:<stop id>" (rows carry data-bus, so the page's bus screen,
// history and Back work unchanged).
import { busT, escHtml as esc, clockFor } from './view.js';
import { headwayNow, nextArrival } from './sim.js';

// GTFS routes.txt route_desc -> the chip's label. The values are the feed's own; only two are shortened.
export const KINDS = [
  ['BRT', 'BRT'], ['Angkutan Umum Integrasi', 'Non-BRT'], ['Mikrotrans', 'Mikrotrans'], ['Transjabodetabek', 'Transjabodetabek'],
  ['Royaltrans', 'Royaltrans'], ['Rusun', 'Rusun'], ['Bus Wisata', 'Wisata'],
];
const kindRank = (k) => { const i = KINDS.findIndex((x) => x[0] === k); return i < 0 ? KINDS.length : i; };
export const kindLabel = (k) => KINDS.find((x) => x[0] === k)?.[1] || k || '';
export const isRef = (id) => /^[rs]:/.test(String(id || ''));
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();

/** Lookups over the pack + the simulator's trips (sim.js simTrips: trips[i] goes with pack.pats[i]). */
export function makeBrowse(pack, trips) {
  const routes = pack.routes.map((r) => ({ id: r.id, tag: r.tag.ja, name: r.tag.en !== r.tag.ja ? r.tag.en : '', kind: r.kind || '', color: r.color, pats: [], key: fold(`${r.tag.ja} ${r.tag.en}`) }));
  const byId = new Map(routes.map((r) => [r.id, r]));
  const atStop = new Map();   // stop index -> [{ ti, j }]: the patterns that call there (not as their last stop)
  trips.forEach((tr, ti) => {
    byId.get(tr.route)?.pats.push(ti);
    const st = pack.pats[ti].stops;
    for (let j = 0; j < st.length - 1; j++) { if (!atStop.has(st[j])) atStop.set(st[j], []); atStop.get(st[j]).push({ ti, j }); }
  });
  const sorted = routes.filter((r) => r.pats.length).sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.tag.localeCompare(b.tag, 'en', { numeric: true }));
  const kinds = KINDS.map(([k]) => [k, sorted.filter((r) => r.kind === k).length]).filter((x) => x[1]);
  return { pack, trips, routes: sorted, byId, atStop, kinds, kind: null, stopKeys: null };
}

/** Route ids of a service type (the map filter), or null for all. */
export const routeIdsOf = (B, kind) => (kind ? new Set(B.routes.filter((r) => r.kind === kind).map((r) => r.id)) : null);

/** The route's smallest headway now (s) over its patterns, or null when none runs. */
function routeHeadway(B, r, ms) {
  let best = null;
  for (const ti of r.pats) { const h = headwayNow(B.trips[ti], B.pack.sim.calendar, ms); if (h != null && (best == null || h < best)) best = h; }
  return best;
}
const everyText = (t, h) => (h == null ? t('bus.notnow') : t('bus.every', { n: Math.max(1, Math.round(h / 60)) }));
const tagHtml = (r, sm = true) => `<span class="tkb-tag${sm ? ' sm' : ''}" aria-hidden="true"><b>${esc(r.tag || '·')}</b></span>`;
const routeRow = (r, title, sub, right = '') => `<button type="button" class="row tkb-row" data-bus="r:${esc(r.id)}" style="--rc:${esc(r.color)}" aria-label="${esc([r.tag, title, sub, right].filter(Boolean).join(', '))}">${tagHtml(r)}<span class="rt"><b>${esc(title)}</b><span>${esc(sub)}</span></span>${right ? `<span class="rr"><small>${esc(right)}</small></span>` : ''}</button>`;

/** The service-type chips (data-buskind; index.js listens): All + the types the feed has. */
function kindChips(B, t) {
  const c = (k, label, n) => `<button type="button" class="chip" data-buskind="${esc(k)}" aria-pressed="${(B.kind || '') === k}">${esc(label)} <b>${n}</b></button>`;
  return `<div class="chips kr-chips tkb-kinds" role="group" aria-label="${esc(t('bus.kinds'))}">${c('', t('bus.kind.all'), B.routes.length)}${B.kinds.map(([k, n]) => c(k, kindLabel(k), n)).join('')}</div>`;
}

/** The Lines tab's TransJakarta section: chips, then every route (BRT corridors first) with its headway now. */
export function linesHtml(B, ctx = {}) {
  const t = busT(ctx.lang, ctx.t), ms = ctx.now ?? Date.now();
  const list = B.kind ? B.routes.filter((r) => r.kind === B.kind) : B.routes;
  const rows = list.map((r) => routeRow(r, r.name || r.tag, `${kindLabel(r.kind)} · ${everyText(t, routeHeadway(B, r, ms))}`));
  return `<section class="sec" data-opgrp="tj"${ctx.hidden ? ' hidden' : ''}><div class="sech"><h2>TransJakarta</h2><small>${esc(t('bus.routes.sub', { n: list.length }))}</small></div>${kindChips(B, t)}<div class="list">${rows.join('')}</div></section>`;
}

const closeBtn = (ctx, t) => (ctx.close ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(t('close'))}"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button>` : '');
const foot = (t, note) => `<p class="tkb-note">${esc(t(note))}</p><p class="tkb-credit">${esc(t('bus.credit'))}</p>`;
const gone = (ctx, t) => `<section class="tkb">${ctx.close ? `<div class="ph" data-drag><div class="rt"></div>${closeBtn(ctx, t)}</div>` : ''}<p class="tkb-note">${esc(t('bus.ref.gone'))}</p></section>`;

/** A route's directions: one pattern per headsign, the one running now when there is a choice. */
function dirsOf(B, r, ms) {
  const by = new Map();
  for (const ti of r.pats) {
    const head = B.pack.heads[B.pack.pats[ti].head]?.en || '', h = headwayNow(B.trips[ti], B.pack.sim.calendar, ms), cur = by.get(head);
    if (!cur || (cur.h == null && h != null) || (h != null && h < cur.h)) by.set(head, { ti, head, h });
  }
  return [...by.values()].sort((a, b) => (a.h ?? Infinity) - (b.h ?? Infinity));   // the busiest direction first, those not running last
}

/** The route sheet ("r:<id>"): type, headway now, buses on the road (n: index.js counts them), each direction's stops. */
export function routeSheet(B, id, ctx = {}) {
  const t = busT(ctx.lang, ctx.t), ms = ctx.now ?? Date.now(), r = B.byId.get(id);
  if (!r) return gone(ctx, t);
  const dirs = dirsOf(B, r, ms).map((d, i) => {
    const pat = B.pack.pats[d.ti];
    const stops = pat.stops.map((k, j) => `<li class="${j === pat.stops.length - 1 ? 'end' : ''}"><i aria-hidden="true"></i><button type="button" class="tkb-stopbtn" data-bus="s:${esc(B.pack.stops[k].id)}">${esc(B.pack.stops[k].name.en)}</button></li>`).join('');
    return `<details class="tkb-dir"${i === 0 ? ' open' : ''}><summary><b>${esc(t('bus.for', { name: d.head }))}</b><span>${esc(`${everyText(t, d.h)} · ${t('bus.stops.n', { n: pat.stops.length })}`)}</span></summary><ol class="tkb-stops">${stops}</ol></details>`;
  }).join('');
  return `<section class="tkb" data-bus="r:${esc(r.id)}" style="--rc:${esc(r.color)}">
  <div class="ph" data-drag>${tagHtml(r, false)}<div class="rt"><h2>${esc(r.name || r.tag)}</h2><p>${esc(`${kindLabel(r.kind)} · TransJakarta · ${everyText(t, routeHeadway(B, r, ms))}`)}</p></div>${closeBtn(ctx, t)}</div>
  <p class="tkb-live"><span class="tkb-dot" aria-hidden="true"></span>${esc(t('bus.route.buses', { n: ctx.n ?? 0 }))}</p>
  <div class="sech"><h2>${esc(t('bus.route.dirs'))}</h2></div>${dirs}
  ${foot(t, 'bus.note')}
</section>`;
}

const etaText = (t, s, ms, lang) => (s == null ? t('bus.eta.none') : s < 60 ? t('bus.eta.now') : s < 3600 ? t('bus.eta', { n: Math.round(s / 60) }) : clockFor(ms + s * 1000, lang));

/** The stop sheet ("s:<id>"): the routes that call there, each with its next arrival ESTIMATED from the timetable. */
export function stopSheet(B, id, ctx = {}) {
  const t = busT(ctx.lang, ctx.t), ms = ctx.now ?? Date.now(), k = B.pack.stopIx.get(id), s = B.pack.stops[k];
  if (!s) return gone(ctx, t);
  const by = new Map();   // route + headsign -> the soonest arrival
  for (const { ti, j } of B.atStop.get(k) || []) {
    const tr = B.trips[ti], head = B.pack.heads[B.pack.pats[ti].head]?.en || '', key = `${tr.route}|${head}`;
    const eta = nextArrival(tr, j, B.pack.sim.calendar, ms), cur = by.get(key);
    if (!cur || (eta != null && (cur.eta == null || eta < cur.eta))) by.set(key, { r: B.byId.get(tr.route), head, eta });
  }
  const rows = [...by.values()].filter((x) => x.r).sort((a, b) => (a.eta ?? Infinity) - (b.eta ?? Infinity) || a.r.tag.localeCompare(b.r.tag, 'en', { numeric: true }))
    .map((x) => routeRow(x.r, t('bus.for', { name: x.head }), x.r.name || kindLabel(x.r.kind), etaText(t, x.eta, ms, ctx.lang)));
  const lead = '<span class="tkb-tag" aria-hidden="true" style="--rc:#6B6B70"><svg class="i" viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="14" rx="3"/><path d="M5 11h14M8.5 14.5h.01M15.5 14.5h.01M8 17.5V20M16 17.5V20"/></svg></span>';
  return `<section class="tkb" data-bus="s:${esc(s.id)}">
  <div class="ph" data-drag>${lead}<div class="rt"><h2>${esc(s.name.en)}</h2><p>${esc(`${t('bus.stop')} · TransJakarta`)}</p></div>${closeBtn(ctx, t)}</div>
  <div class="sech"><h2>${esc(t('bus.stop.routes'))}</h2><small>${esc(t('bus.eta.sub'))}</small></div>
  ${rows.length ? `<div class="list">${rows.join('')}</div>` : `<p class="tkb-note">${esc(t('bus.eta.none'))}</p>`}
  ${foot(t, 'bus.eta.note')}
</section>`;
}

/** Search rows for q: bus routes (number or name), then bus stops (name), '' when nothing matches. */
export function searchHtml(B, q, ctx = {}) {
  const t = busT(ctx.lang, ctx.t), ms = ctx.now ?? Date.now(), k = fold(q);
  if (!k) return '';
  const rank = (key, first) => (first === k ? 0 : first.startsWith(k) ? 1 : key.startsWith(k) ? 2 : key.includes(k) ? 3 : -1);
  const routes = B.routes.map((r) => [rank(r.key, fold(r.tag)), r]).filter((x) => x[0] >= 0).sort((a, b) => a[0] - b[0]).slice(0, 6)
    .map(([, r]) => routeRow(r, r.name || r.tag, `${kindLabel(r.kind)} · ${everyText(t, routeHeadway(B, r, ms))}`));
  B.stopKeys ||= B.pack.stops.map((s) => fold(s.name.en));
  const stops = [];
  for (let i = 0, n = 0; i < B.stopKeys.length; i++) {
    const rk = rank(B.stopKeys[i], B.stopKeys[i]);
    if (rk < 0 || !B.atStop.has(i)) continue;
    stops.push([rk, i]);
    if (rk <= 1 && ++n >= 40) break;   // plenty of close matches already
  }
  const stopRows = stops.sort((a, b) => a[0] - b[0]).slice(0, 8).map(([, i]) => {
    const s = B.pack.stops[i], tags = [...new Set(B.atStop.get(i).map((x) => B.byId.get(B.trips[x.ti].route)?.tag))].filter(Boolean);
    const sub = `${t('bus.stop')} · ${tags.slice(0, 5).join(', ')}${tags.length > 5 ? ` +${tags.length - 5}` : ''}`;
    return `<button type="button" class="row tkb-row" data-bus="s:${esc(s.id)}" aria-label="${esc(`${s.name.en}, ${sub}`)}"><span class="tkb-tag sm" aria-hidden="true" style="--rc:#6B6B70"><b>H</b></span><span class="rt"><b>${esc(s.name.en)}</b><span>${esc(sub)}</span></span></button>`;
  });
  const sec = (title, rows) => (rows.length ? `<section class="sec"><div class="sech"><h2>${esc(title)}</h2><small>${esc(t('bus.list.sub'))}</small></div><div class="list">${rows.join('')}</div></section>` : '');
  return sec(t('bus.search.routes'), routes) + sec(t('bus.search.stops'), stopRows);
}
