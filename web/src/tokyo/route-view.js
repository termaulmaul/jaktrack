// the journey planner screen of the app (from / to, leave now / at / arrive by, up to three
// ways to go, each one's trains and changes, drawn on the map when tapped). Phone first: 44 px controls, one column.
//
//   import { mountRouteView, attachRouteLayer } from './route-view.js';
//   const h = mountRouteView(el, { ...ctx, highlight });   // el: a container the page does not re-render
//   h.setFrom(stationIdOrIndex) / h.setTo(...)             // "Route from here" / "Route to here" on a station
//   h.rerender()  (language switched)     h.destroy()  (screen closed: clears the map highlight it drew)
//
// ctx (page.js's view ctx): { model (unpacked network or model.js model), runs, map?, isDesktop?, open?(type, id),
//   highlight?(option | null, geojson), onPlan?(options, query), loadRuns?(o), search? (search.js's createSearch result,
//   else the view makes its own), now? (the page clock: ms or () => ms; a playback moves it), source?: 'data' |
//   'fixture', from?, to? }.
// Without ctx.highlight the view draws on ctx.map itself (attachRouteLayer). Times are timetable times (rule 6).
// Station names: Mini Tokyo 3D (MIT, (c) Akihiko Kusanagi).

import { createPlanner, routeGeoJSON, routeBounds, addDays } from './route.js';
import { loadRuns as ttLoadRuns } from './tt.js';
import { calendarAt } from './calendar.js';
import { createSearch } from './search.js';
import { t, tn, title, lang as curLang, clock } from './i18n.js';
import { lineChip, typeChip } from './types.js';
import { esc } from '../app/format.js';

const DATA = '/data/tokyo';
const KEEP_MS = 30 * 60e3;
let last = null; // { st, net, at }: the last search, restored by the next mount
const planners = new WeakMap();
const searches = new WeakMap();

/** The planner's run loader minus the runs of suspended lines (model.js SUSPENDED, e.g. Isumi: MT3D's timetable still
 *  runs them; the map draws none): the planner never routes over a suspended line. */
export function withoutSuspended(net, loadRuns) {
  return async (o) => {
    const runs = await loadRuns(o);
    const off = net?.suspended;
    return off?.size && Array.isArray(runs) ? runs.filter((r) => !off.has(r.line)) : runs;
  };
}

/** One planner per network object (kept across mounts: its timetable index cache survives closing the screen). */
export function plannerFor(ctx) {
  const net = ctx.model;
  if (!net?.stations?.length) return null;
  let p = planners.get(net);
  if (p) return p;
  const fixture = ctx.source ? ctx.source === 'fixture' : net.stations.length < 500;
  const loadRuns = ctx.loadRuns || (fixture
    ? async () => ctx.runs || []
    : async (o) => {
      try { return await ttLoadRuns({ base: DATA, ...o }); } catch (e) { if (ctx.runs?.length) return ctx.runs; throw e; }
    });
  p = createPlanner({ net, loadRuns: withoutSuspended(net, loadRuns), ...(fixture ? { calendar: () => [net.calendar || 'holiday'] } : {}) });
  planners.set(net, p);
  return p;
}
function searchFor(net) {
  let s = searches.get(net);
  if (!s) { s = createSearch(net); searches.set(net, s); }
  return s;
}

// ------------------------------------------------------------------ map highlight
const SRC = 'tk-route';
/**
 * Draws a chosen option on a MapLibre map: rides in their line colour over a white casing, walks dashed, the stations
 * where you get on / change / get off as rings. Returns highlight(option, geojson?) (null clears) + destroy().
 */
export function attachRouteLayer(map, { before = null, padding = null } = {}) {
  // checked every time: a style reload (language, 3D) drops custom sources and layers
  const ensure = () => {
    if (!map?.getStyle?.()) return false;
    if (map.getSource(SRC) && map.getLayer('tk-route-line')) return true;
    if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const b = before || (map.getLayer('tokyo-trains') ? 'tokyo-trains' : map.getLayer('tk-slabel') ? 'tk-slabel' : undefined);
    const add = (layer) => { if (!map.getLayer(layer.id)) map.addLayer(layer, b); };
    add({ id: 'tk-route-halo', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'ride'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#171717', 'line-opacity': 0.22, 'line-blur': 2, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 11, 12, 14, 15, 18] } });
    add({ id: 'tk-route-casing', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'ride'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 8, 12, 11, 15, 14] } });
    add({ id: 'tk-route-line', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'ride'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4.5, 12, 6.5, 15, 9] } });
    add({ id: 'tk-route-walk', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'walk'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#6B6B70', 'line-width': 3, 'line-dasharray': [0.5, 2] } });
    add({ id: 'tk-route-stop', type: 'circle', source: SRC, filter: ['==', ['get', 'kind'], 'stop'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 7], 'circle-color': '#FFFFFF', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } });
    return true;
  };
  // room for the sheet / pane, as distances from the map's edges; MapLibre adds the map's own padding (page.js sets
  // it for the sheet's peek height), so only the part beyond it is passed
  const padOf = () => {
    if (typeof padding === 'function') return padding();
    if (padding) return padding;
    const c = map.getContainer?.(), r = c?.getBoundingClientRect?.() || { left: 0, top: 0, width: 390, height: 844 };
    const W = typeof innerWidth !== 'undefined' ? innerWidth : r.width, H = r.height || 844;
    let want;
    if (W >= 900) {
      // desktop: the pane sits on the left; if the map runs under it, keep the route clear of it
      const pr = typeof document !== 'undefined' ? document.querySelector('#pane')?.getBoundingClientRect?.() : null;
      const under = pr && pr.width < W * 0.6 && pr.right > r.left + 20 ? pr.right - r.left : 0;
      want = { top: 56, bottom: 56, left: under + 56, right: 72 };
    } else want = { top: Math.min(110, Math.round(H * 0.14)), bottom: H > 500 ? Math.round(H * 0.5) : 24, left: 36, right: 36 };
    const mp = map.getPadding?.() || {};
    const out = {};
    for (const k of ['top', 'bottom', 'left', 'right']) out[k] = Math.max(8, want[k] - (mp[k] || 0));
    // never ask for more than the map has (MapLibre would refuse to move)
    const vx = r.width - out.left - out.right - (mp.left || 0) - (mp.right || 0), vy = H - out.top - out.bottom - (mp.top || 0) - (mp.bottom || 0);
    if (vx < 80) { out.left = 8; out.right = 8; }
    if (vy < 80) { out.top = 8; out.bottom = 8; }
    return out;
  };
  let shown = null; // what is drawn, put back after a style reload
  const onStyle = () => {
    try { if (shown && !map.getSource(SRC) && ensure()) map.getSource(SRC)?.setData(shown); } catch { /* style still loading */ }
  };
  map?.on?.('styledata', onStyle);
  function highlight(option, geo = null, net = null) {
    try {
      const data = option ? geo || (net ? routeGeoJSON(net, option) : null) : null;
      shown = data;
      if (!ensure()) return;
      map.getSource(SRC)?.setData(data || { type: 'FeatureCollection', features: [] });
      const bounds = data && routeBounds(data);
      if (bounds) map.fitBounds(bounds, { padding: padOf(), maxZoom: 14.5, duration: 600 });
    } catch (e) { console.warn('[route] highlight', e); }
  }
  return {
    highlight,
    destroy() {
      shown = null;
      map?.off?.('styledata', onStyle);
      try {
        for (const id of ['tk-route-stop', 'tk-route-walk', 'tk-route-line', 'tk-route-casing', 'tk-route-halo']) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch { /* map gone */ }
    },
  };
}

// ------------------------------------------------------------------ CSS (own classes only; trafik.live tokens)
export const ROUTE_CSS = `
.rt-view{display:grid;gap:16px;min-width:0}
.rt-form{display:grid;gap:10px}
.rt-fields{position:relative;display:grid;gap:6px;padding-right:52px}
.rt-f{height:48px}
.rt-f .rt-dot{flex:none;width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 2.5px var(--text2)}
.rt-f .rt-dot.to{border-radius:2px;box-shadow:none;background:var(--text)}
.rt-f .rt-x{flex:none;width:44px;height:44px;display:grid;place-items:center;color:var(--text3)}
.rt-f .rt-x svg{width:18px;height:18px}
.rt-f input:placeholder-shown+.rt-x{display:none}
.rt-swap{position:absolute;right:0;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--panel);color:var(--text)}
.rt-swap svg{width:20px;height:20px}
.rt-when{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
.rt-when .seg button{height:44px;font-size:14px}
.rt-time{height:44px;min-width:104px;padding:0 12px;border:0;border-radius:var(--r-control);background:var(--panel);color:var(--text);font:600 16px/21px var(--font);font-variant-numeric:tabular-nums}
.rt-time[hidden]{display:none}
.rt-sug{display:grid;gap:8px}
.rt-opt{display:grid;border-radius:18px;background:var(--panel);overflow:hidden}
.rt-opt+.rt-opt{margin-top:10px}
.rt-head{width:100%;display:grid;gap:6px;padding:12px 14px;text-align:left;color:var(--text)}
.rt-head:active,.rt-head:focus-visible{background:var(--elevated)}
.rt-top{display:flex;align-items:baseline;gap:10px;min-width:0}
.rt-times{font:700 19px/24px var(--font);font-variant-numeric:tabular-nums;white-space:nowrap}
.rt-dur{font:600 15px/20px var(--font);color:var(--text);white-space:nowrap}
.rt-badges{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.rt-badge{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;background:var(--bg);color:var(--text2);font:600 13px/1 var(--font);white-space:nowrap}
.rt-badge.x{background:var(--warning-soft);color:#B54708}
.rt-sub{font:400 13px/17px var(--font);color:var(--text2)}
.rt-chips{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0}
.rt-chips .rt-sep{color:var(--text3);font:400 13px/1 var(--font)}
.rt-chips .rt-wk{font:500 12px/1 var(--font);color:var(--text2)}
.rt-legs{display:grid;padding:0 14px 12px 10px}
.rt-st{display:grid;grid-template-columns:48px 20px 1fr;align-items:center;min-height:36px;column-gap:8px}
.rt-st time{font:600 15px/20px var(--font);font-variant-numeric:tabular-nums;text-align:right}
.rt-st b{font:600 15px/20px var(--font);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-st i{justify-self:center;width:12px;height:12px;border-radius:50%;background:var(--bg);box-shadow:inset 0 0 0 3px var(--lc,#6B6B70)}
.rt-ride{display:grid;grid-template-columns:48px 20px 1fr;column-gap:8px}
.rt-ride>.rt-bar{grid-column:2;justify-self:center;width:6px;border-radius:3px;background:var(--lc,#6B6B70)}
.rt-ride>.rt-info{grid-column:3;display:grid;gap:4px;padding:6px 0 8px}
.rt-line{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;font:600 14px/18px var(--font)}
.rt-meta{font:400 13px/17px var(--font);color:var(--text2)}
.rt-thru{font:400 13px/17px var(--font);color:var(--text)}
.rt-tr{position:relative;justify-self:start;display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:999px;background:var(--bg);color:var(--text);font:500 14px/1 var(--font)}
.rt-tr::after{content:"";position:absolute;inset:-2px 0}
.rt-tr:active,.rt-tr:focus-visible{background:var(--elevated)}
.rt-walk{display:grid;grid-template-columns:48px 20px 1fr;column-gap:8px;align-items:center;min-height:34px}
.rt-walk>.rt-dots{grid-column:2;justify-self:center;width:4px;height:100%;min-height:26px;background:radial-gradient(circle,var(--text3) 1.6px,transparent 1.8px) 0 0/4px 7px repeat-y}
.rt-walk>span{grid-column:3;font:400 13px/17px var(--font);color:var(--text2)}
.rt-wait{display:grid;gap:10px;justify-items:center;padding:20px 0;color:var(--text2);font:500 14px/19px var(--font)}
.rt-note{margin:0}
.rt-lv{font:500 13px/17px var(--font);color:var(--text2)}
.rt-lv.late{color:#B54708;font-weight:600}
.rt-sug:empty,.rt-res:empty{display:none}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head) return;
  cssDone = true;
  if (document.getElementById('rt-css')) return;
  const el = document.createElement('style');
  el.id = 'rt-css';
  el.textContent = ROUTE_CSS;
  document.head.appendChild(el);
}

// ------------------------------------------------------------------ text helpers
const SWAP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PIN_SVG = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>';

export function durText(sec) {
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 60) return t('rt.min', { n: m });
  return t('rt.hm', { h: Math.floor(m / 60), m: m % 60 });
}
export const changesText = (n) => (n === 0 ? t('rt.chg.0') : tn('rt.chg', n));

function stationName(net, s) {
  const st = net.stations[s];
  if (!st) return '';
  return title(st.uname && curLang() !== 'ja' ? st.uname : st.name) || title(st.name);
}
/** a ride's live marker: "6 min late · live" / "About 2 min late · estimated" / "Live position" (a
 *  live place without a reported figure: no minutes); '' on the timetable. route.js gives leg.live / delay / figure. */
export function liveMark(l) {
  if (!l || !l.live || l.live === 'timetable') return '';
  const n = Math.max(0, Math.round((l.delay || 0) / 60));
  if (l.live === 'live') return l.figure === false ? t('rt.lv.pos') : n ? t('rt.lv.live', { n }) : t('rt.lv.live0');
  return n ? t('rt.lv.est', { n }) : t('rt.lv.est0');
}

function headsign(net, leg) {
  if (leg.to >= 0 && net.stations[leg.to]) return t('rt.for', { name: title(net.stations[leg.to].name) });
  const d = net.dirs?.[leg.dir];
  return d ? title(d.title) : '';
}

/** One option's card: head (times, duration, changes, line chips), legs when open. Plain HTML string. */
export function optionHTML(net, o, i, open, nowSec = null) {
  const L = curLang();
  const badges = [];
  if (o.best?.includes('fast')) badges.push(`<span class="rt-badge fast">${esc(t('rt.fast'))}</span>`);
  if (o.best?.includes('few')) badges.push(`<span class="rt-badge">${esc(t('rt.few'))}</span>`);
  if (o.legs.some((l) => l.extraFare)) badges.push(`<span class="rt-badge x">${esc(t('rt.extra'))}</span>`);
  const chips = [];
  for (const l of o.legs) {
    if (l.kind === 'ride') {
      if (chips.length) chips.push('<span class="rt-sep" aria-hidden="true">›</span>');
      const seen = new Set();
      for (const x of l.lines) { const line = net.lines[x.line]; if (line && !seen.has(line.color + line.code)) { seen.add(line.color + line.code); chips.push(lineChip(line, L, { size: 'xs' })); } }
    } else if (!l.same && !l.inside && l.sec >= 120) {
      if (chips.length) chips.push('<span class="rt-sep" aria-hidden="true">›</span>');
      chips.push(`<span class="rt-wk">${esc(t('rt.min', { n: Math.round(l.sec / 60) }))}</span>`);
    }
  }
  const subBits = o.rides ? [changesText(o.transfers)] : [];
  if (nowSec != null && !o.nextDay) {
    const m = Math.floor((o.dep - nowSec) / 60);
    if (m >= 0 && m < 60) subBits.unshift(m === 0 ? t('rt.leave.now') : t('rt.leave.in', { n: m }));
  }
  if (o.walk >= 60 && (!o.rides || o.legs.some((l) => l.kind === 'walk' && !l.inside && !l.same))) subBits.push(`${t('rt.walk.only')} ${t('rt.min', { n: Math.round(o.walk / 60) })}`);
  if (o.nextDay) subBits.push(t('rt.tomorrow'));
  const fr = o.legs.find((l) => l.kind === 'ride');
  if (fr && liveMark(fr)) subBits.push(liveMark(fr));
  // the option's name carries what the row shows: lines, badges, "leaves in N min"
  const rideNames = o.legs.filter((l) => l.kind === 'ride').map((l) => [...new Set((l.lines || []).map((x) => title(net.lines[x.line]?.title)).filter(Boolean))].join(' / ')).filter(Boolean);
  const label = [t('rt.leave', { time: clock(o.dep) }), t('rt.arrive', { time: clock(o.arr) }), durText(o.dur), o.rides ? changesText(o.transfers) : t('rt.walk.only'),
    rideNames.join(' › '), o.best?.includes('fast') && t('rt.fast'), o.best?.includes('few') && t('rt.few'), o.legs.some((l) => l.extraFare) && t('rt.extra'),
    ...subBits.filter((b) => b !== changesText(o.transfers))].filter(Boolean).join(', ');
  const head = `<button type="button" class="rt-head" data-rt-opt="${i}" aria-expanded="${open}" aria-label="${esc(label)}">
    <span class="rt-top"><span class="rt-times">${esc(clock(o.dep))} – ${esc(clock(o.arr))}</span><span class="rt-dur">${esc(durText(o.dur))}</span><span class="rt-badges">${badges.join('')}</span></span>
    <span class="rt-chips">${chips.join('')}</span>
    <span class="rt-sub">${esc(subBits.join(' · '))}</span>
  </button>`;
  return `<div class="rt-opt">${head}${open ? legsHTML(net, o) : ''}</div>`;
}

function legsHTML(net, o) {
  const L = curLang(), out = [];
  for (let i = 0; i < o.legs.length; i++) {
    const l = o.legs[i];
    if (l.kind === 'walk') {
      let text;
      if (l.dest) text = t('rt.walk.end');
      else if (l.origin) text = t('rt.walk.start', { name: stationName(net, l.to) });
      else if (l.same || l.inside) text = t('rt.change', { name: stationName(net, l.to) });
      else text = t('rt.walk', { name: stationName(net, l.to) });
      const bits = [durText(l.sec)];
      if (l.m >= 50 && !l.same) bits.push(`${Math.round(l.m / 10) * 10} m`);
      out.push(`<div class="rt-walk"><span class="rt-dots" aria-hidden="true"></span><span>${esc(text)} · ${esc(bits.join(' · '))}</span></div>`);
      continue;
    }
    const line = net.lines[l.line] || {};
    const color = line.color || '#6B6B70';
    const type = net.types?.[l.type];
    const thru = l.lines.slice(1).map((x) => t('rt.through', { name: stationName(net, x.from), line: title(net.lines[x.line]?.title) }));
    const meta = [tn('rt.stops', l.stops), t('rt.ride', { min: durText(l.arr - l.dep) })];
    out.push(`<div class="rt-st" style="--lc:${esc(color)}"><time>${esc(clock(l.dep))}</time><i aria-hidden="true"></i><b>${esc(stationName(net, l.board))}</b></div>
      <div class="rt-ride" style="--lc:${esc(color)}"><span class="rt-bar" aria-hidden="true"></span><div class="rt-info">
        <span class="rt-line">${lineChip(line, L, { size: 'xs' })}<span>${esc(title(line.title))}</span>${type ? typeChip(type, L) : ''}${l.extraFare ? `<span class="rt-badge x">${esc(t('rt.extra'))}</span>` : ''}</span>
        <span class="rt-meta">${esc([headsign(net, l), ...meta].filter(Boolean).join(' · '))}</span>
        ${liveMark(l) ? `<span class="rt-lv ${l.live}${l.live === 'live' && l.figure !== false && Math.round(l.delay / 60) > 0 ? ' late' : ''}">${esc(liveMark(l))}</span>` : o.live ? `<span class="rt-lv">${esc(t('sched'))}</span>` : ''}
        ${thru.map((x) => `<span class="rt-thru">${esc(x)}</span>`).join('')}
        ${l.key ? `<button type="button" class="rt-tr" data-train="${esc(l.key)}">${esc(t('rt.train'))}</button>` : ''}
      </div></div>
      <div class="rt-st" style="--lc:${esc(color)}"><time>${esc(clock(l.arr))}</time><i aria-hidden="true"></i><b>${esc(stationName(net, l.alight))}</b></div>`);
  }
  return `<div class="rt-legs">${out.join('')}</div>`;
}

// ------------------------------------------------------------------ the screen
const two = (n) => String(n).padStart(2, '0');
const hhmm = (sec) => `${two(Math.floor((sec % 86400) / 3600))}:${two(Math.floor((sec % 3600) / 60))}`;

/**
 * Mount the planner into `el`. Returns { setFrom, setTo, plan, rerender, destroy, state }.
 */
export function mountRouteView(el, ctx = {}) {
  ensureCss();
  const net = ctx.model;
  const planner = plannerFor(ctx);
  const search = ctx.search?.query ? ctx.search : net ? searchFor(net) : null;
  let layer = null;
  const highlight = typeof ctx.highlight === 'function' ? ctx.highlight
    : ctx.map ? (layer = attachRouteLayer(ctx.map), (o, geo) => layer.highlight(o, geo, net)) : () => {};
  // the last search survives the screen closing (back from "See this train") and a re-mount by the page
  const prev = last && last.net === net && Date.now() - last.at < KEEP_MS ? last.st : null;
  // re-mounted while typing (the page re-rendered its view): put the caret back in the same field
  const refocus = prev?.focus && Date.now() - last.at < 3000 ? prev.focus : null;
  const st = prev ? { ...prev, focus: refocus, busy: false, seq: 0, loc: null } : {
    from: null, to: null,       // { s: station index } | { lng, lat }
    fromText: '', toText: '', focus: null, // 'from' | 'to' while typing
    mode: 'now', time: '', extraFare: false,
    busy: false, error: '', options: null, open: 0, seq: 0, loc: null,
  };
  const keep = () => { last = { st, net, at: Date.now() }; };
  // the page clock: a playback runs it away from real time (ctx.now = ms at mount, or a function); real time otherwise
  const skew = typeof ctx.now === 'number' && Math.abs(ctx.now - Date.now()) > 5000 ? ctx.now - Date.now() : 0;
  const clockMs = () => (typeof ctx.now === 'function' ? ctx.now() : Date.now() + skew);
  let dead = false;

  const placeText = (p) => (!p ? '' : p.s != null ? stationName(net, p.s) : t('rt.here'));
  const resolve = (v) => {
    if (v == null || !net) return null;
    if (typeof v === 'object' && v.lng != null) return { lng: v.lng, lat: v.lat };
    if (typeof v === 'number') return net.stations[v] ? { s: v } : null;
    const s = net.stations.findIndex((x) => x.id === v);
    return s >= 0 ? { s } : null;
  };

  function when() {
    const now = calendarAt(clockMs());
    if (st.mode === 'now' || !/^\d{2}:\d{2}$/.test(st.time)) return { date: now.date, departSec: Math.floor(now.sec) };
    const [h, m] = st.time.split(':').map(Number);
    let sec = h * 3600 + m * 60, date = now.date;
    if (sec < 3 * 3600) sec += 86400;                 // 00:00-02:59 belongs to the service day before
    if (sec < now.sec - 3600) date = addDays(date, 1); // a time already past today: tomorrow
    return st.mode === 'arr' ? { date, arriveSec: sec } : { date, departSec: sec };
  }

  async function plan({ keepOpen = false } = {}) {
    if (dead) return;
    st.error = '';
    if (!planner || !st.from || !st.to) { st.options = null; render(); return; }
    const seq = ++st.seq;
    st.busy = true;
    render();
    try {
      const w = when();
      const q = { ...w, from: st.from.s != null ? st.from.s : st.from, to: st.to.s != null ? st.to.s : st.to, extraFare: st.extraFare };
      await new Promise((r) => setTimeout(r, 0)); // paint "reading the timetable" first
      const opts = await planner.plan(q);
      if (dead || seq !== st.seq) return;
      const before = keepOpen && st.options?.[st.open]?.sig;
      st.options = opts;
      st.dv = net?.delaysVersion;
      st.error = opts.length ? '' : planner.last?.error === 'same' ? 'same' : 'none';
      const same = before ? opts.findIndex((o) => o.sig === before) : -1;
      st.open = same >= 0 ? same : 0;
      if (!keepOpen || same < 0) {
        highlight(opts[st.open] || null, opts[st.open] ? routeGeoJSON(net, opts[st.open]) : null);
        try { ctx.onPlan?.(opts, q); } catch (e) { console.warn('[route] onPlan', e); }
      }
    } catch (e) {
      console.warn('[route] plan', e);
      if (seq === st.seq) { st.options = null; st.error = 'fail'; }
    } finally {
      if (seq === st.seq) {
        st.busy = false;
        render();
        // say the outcome once per plan the rider started (the 30 s refresh is quiet)
        if (!keepOpen) {
          try {
            ctx.say?.(st.options?.length ? t('rt.found', { n: st.options.length, dur: durText(Math.min(...st.options.map((o) => o.dur))) })
              : t(st.error === 'same' ? 'rt.same' : st.error === 'fail' ? 'rt.fail' : 'rt.none'));
          } catch { /* no live region */ }
        }
      }
    }
  }

  function fieldHTML(which) {
    const text = which === 'from' ? st.fromText : st.toText;
    return `<label class="search rt-f"><span class="rt-dot ${which}" aria-hidden="true"></span>
      <input type="search" data-rt-in="${which}" value="${esc(text)}" placeholder="${esc(t(`rt.${which}.ph`))}" aria-label="${esc(t(`rt.${which}`))}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      <button type="button" class="rt-x" data-rt-clear="${which}" aria-label="${esc(t('rt.clear'))}">${X_SVG}</button></label>`;
  }

  function sugHTML() {
    if (!st.focus) return '';
    const rows = [];
    const q = (st.focus === 'from' ? st.fromText : st.toText).trim();
    const picked = st.focus === 'from' ? st.from : st.to;
    if (!q || (picked && q === placeText(picked))) {
      rows.push(`<button type="button" class="row" data-rt-here="${st.focus}">${`<span class="itile" aria-hidden="true">${PIN_SVG}</span>`}<span class="rt"><b>${esc(t('rt.here'))}</b><span>${esc(st.loc === 'wait' ? t('rt.here.wait') : st.loc === 'no' ? t('rt.here.no') : t('rt.here.sub'))}</span></span></button>`);
    } else if (search) {
      const res = search.query(q, curLang(), 6);
      for (const r of res.stations) {
        const seen = new Set(), chips = [];
        for (const li of r.lines) { const line = net.lines[li]; if (line && !seen.has(line.color + line.code) && chips.length < 5) { seen.add(line.color + line.code); chips.push(lineChip(line, curLang(), { size: 'xs' })); } }
        // the other-script name tagged with its language (浅草 on an EN page is Japanese)
        const other = r.other ? `<span lang="${curLang() === 'ja' ? 'en' : 'ja'}">${esc(r.other)}</span>` : '';
        const sub = [r.code ? esc(r.code) : '', other].filter(Boolean).join(' · ');
        rows.push(`<button type="button" class="row" data-rt-pick="${r.s}"><span class="rt"><b>${esc(r.name)}</b>${sub ? `<span>${sub}</span>` : ''}</span><span class="rr"><span class="rt-chips">${chips.join('')}</span></span></button>`);
      }
      if (!rows.length) return `<p class="fine">${esc(t('search.none', { q }))}</p>`;
    }
    return `<div class="list">${rows.join('')}</div>`;
  }

  // seconds of the options' service day now (for "in 4 min"), null when the options are for another day
  function nowFor(o) {
    const c = calendarAt(clockMs());
    return o.date === c.date ? c.sec : null;
  }
  function resultsHTML() {
    if (st.focus) return '';
    if (!st.from || !st.to) return `<p class="fine">${esc(t('rt.pick'))}</p>`;
    if (st.busy && !st.options) return `<div class="rt-wait" role="status">${esc(t('rt.loading'))}</div>`;
    if (st.error === 'fail') return `<div class="empty compact"><b>${esc(t('rt.fail'))}</b><button type="button" class="btn primary" data-rt-retry>${esc(t('retry'))}</button></div>`;
    if (st.error === 'same') return `<div class="empty compact"><b>${esc(t('rt.same'))}</b></div>`;
    if (st.error === 'none' || !st.options?.length) return `<div class="empty compact"><b>${esc(t('rt.none'))}</b><span>${esc(t('rt.none.sub'))}</span></div>`;
    const night = st.options[0].nextDay ? `<p class="fine">${esc(t('rt.nextday'))}</p>` : '';
    return `<section class="sec"><div class="sech"><h2>${esc(t('rt.options'))}</h2><small>${esc(st.options.some((o) => o.live) ? t('rt.live.some') : t('sched'))}</small></div>${night}
      <div class="rt-list"${st.busy ? ' aria-busy="true"' : ''}>${st.options.map((o, i) => optionHTML(net, o, i, i === st.open, nowFor(o))).join('')}</div></section>`;
  }

  // three parts, so typing never replaces the field being typed in (phones close the keyboard when it is)
  function formHTML() {
    return `<div class="rt-fields">${fieldHTML('from')}${fieldHTML('to')}
        <button type="button" class="rt-swap" data-rt-swap aria-label="${esc(t('rt.swap'))}">${SWAP_SVG}</button></div>
      <div class="rt-when">
        <div class="seg" role="tablist" aria-label="${esc(t('rt.time'))}">${['now', 'dep', 'arr'].map((m) => `<button type="button" role="tab" data-rt-mode="${m}" aria-selected="${st.mode === m}">${esc(t(`rt.${m}`))}</button>`).join('')}</div>
        <input type="time" class="rt-time" data-rt-time value="${esc(st.time)}" aria-label="${esc(t('rt.time'))}"${st.mode === 'now' ? ' hidden' : ''}>
      </div>
      <div class="list"><button type="button" class="swrow" role="switch" aria-checked="${st.extraFare}" data-rt-fare>
        <span class="rt"><b>${esc(t('rt.fare'))}</b><span>${esc(t('rt.fare.sub'))}</span></span><span class="switch" aria-hidden="true"></span></button></div>`;
  }
  let parts = null;
  function render({ form = true } = {}) {
    if (dead) return;
    keep();
    if (!parts || !el.contains(parts.form)) {
      // the screen's heading (the planner had none; the page focuses `.ph h2` when a screen opens)
      el.innerHTML = `<div class="rt-view"><div class="ph rt-ph" data-drag><div class="rt"><h2></h2></div></div><div class="rt-form"></div><div class="rt-sug"></div><div class="rt-res"></div>
        <p class="kr-note rt-note"></p></div>`;
      parts = { title: el.querySelector('.rt-ph h2'), form: el.querySelector('.rt-form'), sug: el.querySelector('.rt-sug'), res: el.querySelector('.rt-res'), note: el.querySelector('.rt-note') };
      form = true;
    }
    const typing = typeof document !== 'undefined' && document.activeElement?.dataset?.rtIn && parts.form.contains(document.activeElement);
    if (form && !typing) parts.form.innerHTML = formHTML();
    else {
      // keep the focused field; refresh the rest of the form around it
      for (const w of ['from', 'to']) {
        const inp = parts.form.querySelector(`[data-rt-in="${w}"]`);
        if (inp && inp !== document.activeElement) inp.value = w === 'from' ? st.fromText : st.toText;
      }
      for (const b of parts.form.querySelectorAll('[data-rt-mode]')) b.setAttribute('aria-selected', String(b.dataset.rtMode === st.mode));
      const ti = parts.form.querySelector('[data-rt-time]');
      if (ti) ti.hidden = st.mode === 'now';
      parts.form.querySelector('[data-rt-fare]')?.setAttribute('aria-checked', String(st.extraFare));
    }
    parts.sug.innerHTML = sugHTML();
    // the 30 s tick redraws: keep the node when nothing changed, else put the focus back on the same option / train
    const a = typeof document !== 'undefined' ? document.activeElement : null, inRes = !!a && parts.res.contains(a);
    const opt = inRes ? a.closest?.('[data-rt-opt]')?.dataset.rtOpt : null, trk = inRes ? a.dataset?.train : null;
    const h = resultsHTML();
    if (parts.res.__h !== h) { parts.res.__h = h; parts.res.innerHTML = h; }
    if (inRes && !parts.res.contains(document.activeElement)) {
      const q = opt != null ? `[data-rt-opt="${opt}"]` : trk ? `[data-train="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(trk) : trk}"]` : null;
      (q ? parts.res.querySelector(q) : null)?.focus({ preventScroll: true });
    }
    parts.note.textContent = t(st.options?.some((o) => o.live) ? 'rt.note.live' : 'rt.note');
    if (parts.title) parts.title.textContent = t('rt.title');
  }

  function setPlace(which, place, { run = true } = {}) {
    if (which === 'from') { st.from = place; st.fromText = placeText(place); } else { st.to = place; st.toText = placeText(place); }
    st.focus = null;
    if (run) plan(); else render();
  }

  function askHere(which) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { st.loc = 'no'; render(); return; }
    st.loc = 'wait';
    render();
    navigator.geolocation.getCurrentPosition((p) => {
      if (dead) return;
      st.loc = null;
      setPlace(which, { lng: p.coords.longitude, lat: p.coords.latitude });
    }, () => { if (!dead) { st.loc = 'no'; render(); } }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  const onClick = (e) => {
    const b = e.target.closest?.('[data-rt-opt],[data-rt-pick],[data-rt-here],[data-rt-swap],[data-rt-mode],[data-rt-fare],[data-rt-clear],[data-rt-retry]');
    if (!b || !el.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    const d = b.dataset;
    if (d.rtOpt != null) {
      const i = +d.rtOpt;
      st.open = st.open === i ? -1 : i;
      const o = st.options?.[st.open];
      highlight(o || null, o ? routeGeoJSON(net, o) : null);
      render({ form: false });
      el.querySelector(`[data-rt-opt="${i}"]`)?.focus({ preventScroll: true });
    } else if (d.rtPick != null) { const which = st.focus || (st.from ? 'to' : 'from'); setPlace(which, { s: +d.rtPick }); focusNext(which); }
    else if (d.rtHere != null) askHere(d.rtHere);
    else if (d.rtSwap != null) {
      [st.from, st.to] = [st.to, st.from];
      st.fromText = placeText(st.from); st.toText = placeText(st.to);
      plan();
    } else if (d.rtMode) {
      st.mode = d.rtMode;
      if (st.mode !== 'now' && !st.time) st.time = hhmm(Math.floor(calendarAt(clockMs()).sec));
      plan();
    } else if (d.rtFare != null) { st.extraFare = !st.extraFare; plan(); }
    else if (d.rtClear) {
      if (d.rtClear === 'from') { st.from = null; st.fromText = ''; } else { st.to = null; st.toText = ''; }
      st.focus = d.rtClear; st.options = null; highlight(null);
      render();
      el.querySelector(`[data-rt-in="${d.rtClear}"]`)?.focus();
    } else if (d.rtRetry != null) plan();
  };
  const onInput = (e) => {
    const w = e.target.dataset?.rtIn;
    if (w) {
      if (w === 'from') st.fromText = e.target.value; else st.toText = e.target.value;
      st.focus = w;
      render({ form: false });
    } else if (e.target.dataset?.rtTime != null) {
      st.time = e.target.value;
      if (/^\d{2}:\d{2}$/.test(st.time)) plan();
    }
  };
  const onFocus = (e) => {
    const w = e.target.dataset?.rtIn;
    if (w && st.focus !== w) { st.focus = w; render({ form: false }); }
  };
  // keyboard: ArrowDown from a field walks into its suggestions, Up / Down between them, Up from the
  // top or Escape back to the field; Enter in a field takes the first station; Escape in a field closes the list and
  // keeps the focus there (and stops type=search wiping the text)
  const SUG = '.rt-sug [data-rt-pick], .rt-sug [data-rt-here]';
  const onKey = (e) => {
    const row = e.target.closest?.(SUG);
    if (row && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
      const rows = [...el.querySelectorAll(SUG)], i = rows.indexOf(row);
      e.preventDefault();
      if (e.key === 'ArrowDown') rows[Math.min(i + 1, rows.length - 1)].focus();
      else if (e.key === 'ArrowUp' && i > 0) rows[i - 1].focus();
      else el.querySelector(`[data-rt-in="${st.focus || 'from'}"]`)?.focus();
      return;
    }
    const w = e.target.dataset?.rtIn;
    if (!w) return;
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const first = el.querySelector('[data-rt-pick]');
      if (first) { setPlace(w, { s: +first.dataset.rtPick }); focusNext(w); }
    } else if (e.key === 'ArrowDown' && !e.isComposing) {
      const first = el.querySelector(SUG);
      if (first) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Escape' && st.focus) {
      e.preventDefault();
      if (w === 'from') st.fromText = placeText(st.from); else st.toText = placeText(st.to);
      e.target.value = w === 'from' ? st.fromText : st.toText;
      st.focus = null;
      render({ form: false });
    }
  };
  /** After a pick: the next empty field, else the results (a picked row is drawn away: never leave focus on <body>). */
  function focusNext(which) {
    const next = el.querySelector(`[data-rt-in="${which === 'from' ? 'to' : 'from'}"]`);
    if (next && !next.value) next.focus({ preventScroll: true });
    else if (parts?.res) { parts.res.tabIndex = -1; parts.res.focus({ preventScroll: true }); }
  }
  const onFocusOut = () => {
    // leave the suggestions open while a tap on one of them is on its way
    setTimeout(() => {
      if (dead || el.contains(document.activeElement)) return;
      if (st.focus) {
        if (st.focus === 'from') st.fromText = placeText(st.from); else st.toText = placeText(st.to);
        st.focus = null;
        render();
      }
    }, 180);
  };
  // "Now": keep the list fresh (a missed train drops off, the "in N min" counts down); never while typing
  const tick = setInterval(() => {
    if (dead || st.focus || st.busy || !st.options?.length || !st.from || !st.to) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const c = calendarAt(clockMs());
    if (st.mode === 'now' && (st.options.some((o) => o.date === c.date && o.dep < c.sec - 20) || (net?.delaysVersion ?? 0) !== (st.dv ?? 0))) plan({ keepOpen: true });
    else render({ form: false });
  }, 30000);
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('focusin', onFocus);
  el.addEventListener('focusout', onFocusOut);
  el.addEventListener('keydown', onKey);

  if (ctx.from != null) { st.from = resolve(ctx.from); st.fromText = placeText(st.from); }
  if (ctx.to != null) { st.to = resolve(ctx.to); st.toText = placeText(st.to); }
  const stale = !prev || ctx.from != null || ctx.to != null || !st.options || (st.mode === 'now' && Date.now() - last.at > 60e3);
  render();
  if (refocus) {
    const inp = el.querySelector(`[data-rt-in="${refocus}"]`);
    if (inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* fine */ } render({ form: false }); }
  }
  if (refocus) { /* typing: plan when a station is picked */ } else if (st.from && st.to && stale) plan();
  else if (st.from && st.to && st.options?.[st.open]) highlight(st.options[st.open], routeGeoJSON(net, st.options[st.open]));
  else if (planner) {
    // build this hour's index now (and the next hour's near the turn), so the first search is quick
    const w = calendarAt(clockMs()), sec = Math.floor(w.sec);
    planner.warm(w.date, sec).then(() => (sec % 3600 > 3000 ? planner.warm(w.date, sec + 900) : null)).catch(() => {});
  }

  return {
    state: st,
    setFrom(v) { setPlace('from', resolve(v)); },
    setTo(v) { setPlace('to', resolve(v)); },
    plan,
    rerender() { st.fromText = st.focus === 'from' ? st.fromText : placeText(st.from); st.toText = st.focus === 'to' ? st.toText : placeText(st.to); render(); },
    destroy() {
      dead = true;
      clearInterval(tick);
      el.removeEventListener('click', onClick);
      el.removeEventListener('input', onInput);
      el.removeEventListener('focusin', onFocus);
      el.removeEventListener('focusout', onFocusOut);
      el.removeEventListener('keydown', onKey);
      try { highlight(null); } catch { /* fine */ }
      layer?.destroy();
    },
  };
}
