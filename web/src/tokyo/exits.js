// station exits, "which exit". Exit data derived from Mini Tokyo 3D,
// (c) Akihiko Kusanagi, MIT (its poi.json + the `exit` lists of stations.json, packed by data-build/exits/build.mjs).
//
//   import { mountExits, exitsSection, nearestExit } from './exits.js';
//   const ex = mountExits(map, { net, lang });     // loads /data/tokyo/exits-v1.json, adds the map layer
//   ex.showFor(groupIdx)  /  ex.showForStation(stationIdx)  /  ex.clear()  /  ex.fly(exitId | index)  /  ex.setLang(l)
//   exitsSection(groupIdx | { station }, lang, { station }) -> HTML for the station sheet ('' until loaded / no exits)
//   nearestExit(lng, lat, { group, station }) -> { exit, d (metres), bearing } | null      (ROUTE / "near me")
//
// Map: small white discs with an exit glyph (an elevator glyph for station elevators) and the short sign name next to
// them ("A3", "East Exit" / "東口"). The selected complex shows its exits from z15 (names from z16), every exit in view
// shows from z17. MapLibre symbol collision: no exit disc or name overlaps a station dot, a station name or another
// exit (station names win; a name that does not fit is dropped, the disc stays). Tap a disc -> it centres and a small
// card shows its sign text, operator, stairs/escalator/elevator and opening hours. Exits the data marks closed (now,
// today, or always: MT3D uptime open == close) are drawn grey and listed as closed.
// Sheet: an "Exits" section per operator (the sign numbering is per operator), the picked station's operator first;
// a tap on a row flies the map to that exit at z18. Operators of the complex with no exit data are named under it.

import * as I from './i18n.js';
import * as CAL from './calendar.js';

export const EXITS_FILE = 'exits-v1.json';
export const EXIT_LAYERS = ['tk-exit', 'tk-exit-pick'];
const SRC = 'tk-exits', PICK_SRC = 'tk-exit-pick-src';
const L_DOT = 'tk-exit', L_PICK = 'tk-exit-pick';
import { MAP_FONT as FONT } from './config.js';   // = style.js FONT (CJK drawn by the browser)
const LABELS_BEFORE = 'tk-slabel';          // style.js's station names: exits sit under them (names win collisions)
const Z_SEL = 15, Z_NAME = 16, Z_ALL = 17, Z_FLY = 18;
const DISC = 18;                            // disc diameter in css px at icon-size 1
const INK = '#171717', GLYPH = '#2F2F35', RING = '#6B6B72', RING_OFF = '#B4B4BB', GLYPH_OFF = '#A0A0A8', TEXT_OFF = '#8E8E96';
const FAC = [['stairs', 1], ['escalator', 2], ['elevator', 4], ['ramp', 8]];
const CODE_RE = /^(?:[A-Z]{0,2}\d{1,3}[A-Za-z]?(?:-[0-9A-Za-z]{1,2})?|[A-Za-z])$/;
const ROWS_FOLDED = 6;                      // rows shown before "Show all" when a complex has more than ROWS_FOLDED + 2
const D2R = Math.PI / 180;

// glyphs (24-unit box): a doorway with an arrow leaving it; an elevator car with up/down arrows
const EXIT_PATH = 'M11 5H7v14h4M10.5 12H19M15.5 8.5 19 12l-3.5 3.5';
const ELEV_PATH = 'M7.5 4.5h9A1.5 1.5 0 0 1 18 6v12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18V6a1.5 1.5 0 0 1 1.5-1.5z';
const ELEV_FILL = 'M12 7.2 14.6 10.5H9.4zM12 16.8 14.6 13.5H9.4z';
export const EXIT_SVG = `<svg class="tkx-g" viewBox="0 0 24 24" aria-hidden="true"><path d="${EXIT_PATH}"/></svg>`;
export const ELEV_SVG = `<svg class="tkx-g" viewBox="0 0 24 24" aria-hidden="true"><path d="${ELEV_PATH}"/><path class="f" d="${ELEV_FILL}"/></svg>`;

// ------------------------------------------------------------------ data
let DATA = null;          // unpacked pack (module cache: exitsSection / nearestExit read it)
let LOADING = null;
const expanded = new Set();   // complex keys whose full list is open ('g7', 's123')

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The short code on the sign ('A3', '10-b', 'b'), or null for a named exit ('East'). */
export const codeOf = (s) => (s && CODE_RE.test(s) ? s : null);

/** json = parsed exits-v1.json -> { exits, byStation: Map(si -> [x]), byGroup: Map(g -> [x]), missing, ops, names, meta }. */
export function unpackExits(json) {
  if (!json || json.v !== 1 || json.kind !== 'tokyo-exits') throw new Error('unpackExits: not a tokyo-exits v1 pack');
  const F = Object.fromEntries(json.fields.map((k, i) => [k, i]));
  for (const k of ['id', 'lng', 'lat', 'en', 'ja', 'den', 'dja', 'kind', 'fac', 'up', 'st', 'op']) if (F[k] === undefined) throw new Error(`unpackExits: field ${k} missing`);
  const ops = (json.ops || []).map((r) => ({ id: r[0], title: { en: r[1], ja: r[2] || r[1] } }));
  const exits = json.exits.map((r, i) => ({
    i, id: r[F.id], lng: r[F.lng], lat: r[F.lat],
    title: { en: r[F.en], ja: r[F.ja] || r[F.en] }, desc: { en: r[F.den], ja: r[F.dja] || r[F.den] },
    kind: r[F.kind] === 1 ? 'elevator' : 'exit', code: codeOf(r[F.en]),
    fac: FAC.filter(([, b]) => r[F.fac] & b).map(([k]) => k),
    up: r[F.up] ? r[F.up].map(([open, close, cal]) => ({ open, close, cal: cal || null })) : null,
    station: r[F.st], op: r[F.op], group: -1,
  }));
  const toMap = (o) => new Map(Object.entries(o || {}).map(([k, v]) => [+k, v]));
  const byStation = toMap(json.stations), byGroup = toMap(json.groups);
  for (const [g, list] of byGroup) for (const x of list) if (exits[x]) exits[x].group = g;
  const names = new Map(Object.entries(json.names || {}).map(([k, v]) => [+k, { en: v[0], ja: v[1] || v[0] }]));
  return { exits, byStation, byGroup, missing: toMap(json.missing), ops, names, sg: json.sg || null, so: json.so || null, meta: json.meta || {} };
}

/** Load (once) and cache the pack. base = where the data is served ('/data/tokyo/'). */
export function loadExits(base = '/data/tokyo/') {
  if (DATA) return Promise.resolve(DATA);
  if (!LOADING) {
    const url = `${String(base).replace(/\/?$/, '/')}${EXITS_FILE}`;
    LOADING = fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); })
      .then((j) => setExitsData(unpackExits(j)))
      .catch((e) => { LOADING = null; throw e; });
  }
  return LOADING;
}
/** Use an already unpacked pack (tests, or a page that fetched it itself). Fires 'tokyo:exits-ready' on window. */
export function setExitsData(d) {
  DATA = d;
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tokyo:exits-ready', { detail: { count: d.exits.length } })); } catch { /* no window */ }
  return d;
}
export const exitsData = () => DATA;

/** Exit indexes of a complex ({ group }) or of a single station ({ station }) (number = group). */
function listFor(key, d = DATA) {
  if (!d || key == null) return [];
  if (typeof key === 'number') return d.byGroup.get(key) || [];
  if (key.group != null && key.group >= 0 && d.byGroup.has(key.group)) return d.byGroup.get(key.group);
  if (key.station != null) {
    const g = groupOfStation(key.station, d);
    if (g >= 0 && d.byGroup.has(g)) return d.byGroup.get(g);
    return d.byStation.get(key.station) || [];
  }
  return [];
}
/** The complex (model.groups index) of a station, -1 when it is in none. */
function groupOfStation(si, d = DATA) {
  if (!d || si == null) return -1;
  const g = d.sg?.[si];
  if (g != null) return g;
  const own = d.byStation.get(si);
  return own?.length ? d.exits[own[0]].group : -1;
}
/** Exit objects of a complex / station. */
export function exitsOf(key, d = DATA) { return listFor(key, d).map((x) => d.exits[x]); }

// ------------------------------------------------------------------ words
const DICT = () => I._dict || {};
/** A UI string in a given language (i18n.js keys, exits.js block), falling back to EN, then the key. */
function tr(lang, key, vars) {
  const D = DICT();
  const s = D[lang]?.[key] ?? D.en?.[key] ?? key;
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : String(s);
}
const trn = (lang, key, n, vars = {}) => tr(lang, n === 1 && lang === 'en' ? `${key}.one` : key, { ...vars, n });
const L = (lang) => (lang === 'ja' ? 'ja' : 'en');   // data names: ID uses the EN sign text

/** The sign text: 'Exit A3' / '出口A3', 'East Exit' / '東口', 'Elevator 1' / 'エレベーター1'. */
export const exitName = (x, lang = I.lang()) => (x ? x.desc[L(lang)] || x.desc.en || x.title.en || '' : '');
/** The other language's sign text (shown small), or ''. */
export function exitNameAlt(x, lang = I.lang()) {
  if (!x) return '';
  const a = L(lang) === 'ja' ? x.desc.en : x.desc.ja;
  return a && a !== exitName(x, lang) ? a : '';
}
/** The short map label: the code on the sign ('A3'), else the sign text ('East Exit' / '東口'); elevators: their code. */
export function shortLabel(x, lang = I.lang()) {
  if (!x) return '';
  if (x.kind === 'elevator') return x.code || '';
  return x.code || exitName(x, lang);
}
const opTitle = (d, op, lang) => { const o = d?.ops[op]; return o ? (L(lang) === 'ja' ? o.title.ja : o.title.en) : ''; };

// ------------------------------------------------------------------ opening hours (MT3D rules, WIB)
const toMin = (s) => (((+s.slice(0, 2)) + 21) % 24) * 60 + (+s.slice(3, 5));   // minutes since 03:00 (service day)
/** MT3D day kind for an instant: 'Weekday' | 'Saturday' | 'Holiday' (Sunday, public holiday, 30 Dec - 3 Jan). */
export function dayKindAt(ms = Date.now()) {
  try { const c = CAL.calendarAt?.(ms); if (c?.kind) return { kind: c.kind, sec: c.sec }; } catch { /* fall through */ }
  const jst = ms + 7 * 3600e3;                                          // WIB; the service day turns at 03:00
  const day0 = Math.floor((jst - 3 * 3600e3) / 86400e3) * 86400e3;      // 00:00 WIB of the service date
  const dow = new Date(day0).getUTCDay();
  return { kind: dow === 0 ? 'Holiday' : dow === 6 ? 'Saturday' : 'Weekday', sec: (jst - day0) / 1000 };
}
/**
 * Opening state of an exit at an instant: { known: false } when the data has no hours (open with the station), else
 * { known: true, open: bool, hours: '06:00–23:00' | null, closed: 'always' | 'today' | 'now' | null, opens: '06:00' | null }.
 */
export function exitState(x, ms = Date.now()) {
  if (!x?.up?.length) return { known: false, open: true, hours: null, closed: null, opens: null };
  if (x.up.every((u) => u.open === u.close)) return { known: true, open: false, hours: null, closed: 'always', opens: null };
  const { kind, sec } = dayKindAt(ms);
  let u = null;
  for (const e of x.up) if (!e.cal || e.cal.includes(kind)) u = e;   // MT3D: the last entry that fits the day wins
  if (!u || u.open === u.close) return { known: true, open: false, hours: null, closed: 'today', opens: null };
  const now = Math.floor(sec / 60) - 180;
  const o = toMin(u.open), c = toMin(u.close);
  const open = now >= o && now < c;
  return { known: true, open, hours: `${u.open}–${u.close}`, closed: open ? null : 'now', opens: !open && now < o ? u.open : null };
}

// ------------------------------------------------------------------ order (the sheet's list)
const codeParts = (c) => { const m = /^([A-Z]{0,2})(\d*)([A-Za-z]?)(?:-(.*))?$/.exec(c) || []; return [m[1] || '', +(m[2] || 0), (m[3] || '').toLowerCase(), m[4] || '']; };
/** Sign order inside one operator: named exits (MT3D order), then codes (1, 2, 10, A1, A2, A10, B1 ...), then elevators. */
export function compareExits(a, b) {
  const ka = a.kind === 'elevator' ? 2 : a.code ? 1 : 0, kb = b.kind === 'elevator' ? 2 : b.code ? 1 : 0;
  if (ka !== kb) return ka - kb;
  if (!a.code || !b.code) return (a.code ? 1 : 0) - (b.code ? 1 : 0) || a.i - b.i;
  const pa = codeParts(a.code), pb = codeParts(b.code);
  return pa[0].localeCompare(pb[0]) || pa[1] - pb[1] || pa[2].localeCompare(pb[2]) || String(pa[3]).localeCompare(String(pb[3]), 'en', { numeric: true }) || a.i - b.i;
}

/** Blocks of the sheet list: one per operator (+ station name when one operator owns exits under several names). */
export function exitBlocks(key, { station = null, lang = I.lang() } = {}, d = DATA) {
  const xs = exitsOf(key, d);
  if (!xs.length) return [];
  const names = new Set(xs.map((x) => d.names.get(x.station)?.en || ''));
  const multi = names.size > 1;
  const firstOp = station == null ? null : d.so?.[station] ?? (d.byStation.get(station)?.length ? d.exits[d.byStation.get(station)[0]].op : null);
  const blocks = new Map();
  for (const x of xs) {
    const nm = d.names.get(x.station);
    const k = `${x.op}|${multi ? nm?.en || '' : ''}`;
    if (!blocks.has(k)) {
      const head = [opTitle(d, x.op, lang), multi && nm ? (L(lang) === 'ja' ? nm.ja : nm.en) : ''].filter(Boolean).join(' · ');
      blocks.set(k, { op: x.op, name: multi ? nm?.en || '' : '', head, exits: [] });
    }
    blocks.get(k).exits.push(x);
  }
  const out = [...blocks.values()];
  for (const b of out) b.exits.sort(compareExits);
  // the picked station's operator first, then operator order (the network build ops: JR, Metro, Toei, ...), then name
  out.sort((a, b) => (a.op === firstOp ? -1 : 0) - (b.op === firstOp ? -1 : 0) || a.op - b.op || a.name.localeCompare(b.name));
  return out;
}

// ------------------------------------------------------------------ nearest exit (ROUTE / "near me")
/** Metres between two [lng, lat] points (net.js segLen metric). */
export function metres(a, b) {
  const k = Math.cos((a[1] + b[1]) * D2R / 2);
  const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy) * D2R * 6371008.8;
}
const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos((a[1] + b[1]) * D2R / 2), b[1] - a[1]) / D2R + 360) % 360;
/**
 * Nearest exit to a point: { exit, d (metres), bearing (deg, from the point to the exit) } or null.
 * opts: group / station (only that complex's exits; omit = any exit), max (metres), elevators (default false: street
 * exits only; 'only' = elevators only), includeClosed (default false: skip exits the data says are closed at `now`).
 */
export function nearestExit(lng, lat, { group = null, station = null, max = Infinity, elevators = false, includeClosed = false, now = Date.now() } = {}, d = DATA) {
  if (!d || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const pool = group != null || station != null ? listFor({ group, station }, d).map((x) => d.exits[x]) : d.exits;
  let best = null, bd = max;
  const p = [lng, lat];
  for (const x of pool) {
    if (elevators === 'only' ? x.kind !== 'elevator' : !elevators && x.kind === 'elevator') continue;
    const dd = metres(p, [x.lng, x.lat]);
    if (dd >= bd) continue;
    if (!includeClosed && !exitState(x, now).open) continue;
    bd = dd; best = x;
  }
  return best ? { exit: best, d: bd, bearing: bearing(p, [best.lng, best.lat]) } : null;
}
/** Exits within `radius` metres of a point, nearest first: [{ exit, d }]. */
export function exitsNear(lng, lat, { radius = 300, limit = 8, elevators = false } = {}, d = DATA) {
  if (!d) return [];
  const p = [lng, lat];
  return d.exits.filter((x) => (elevators || x.kind !== 'elevator'))
    .map((x) => ({ exit: x, d: metres(p, [x.lng, x.lat]) })).filter((r) => r.d <= radius)
    .sort((a, b) => a.d - b.d).slice(0, limit);
}

// ------------------------------------------------------------------ the station sheet section
/** 'HH:MM' times as the page writes them: ID '06.00' (EYD, like i18n clock), EN / JA '06:00'. */
const hmText = (s, lang) => (lang === 'id' ? String(s).replace(/(\d{1,2}):(\d{2})/g, '$1.$2') : s);
const keyOf = (key) => (typeof key === 'number' ? `g${key}` : key?.group != null && key.group >= 0 ? `g${key.group}` : `s${key?.station}`);
function detailWords(x, lang, now) {
  const parts = x.fac.map((f) => tr(lang, `exits.f.${f}`));
  const st = exitState(x, now);
  if (st.closed === 'always') parts.push(tr(lang, 'exits.closed'));
  else if (st.closed === 'today') parts.push(tr(lang, 'exits.closed.today'));
  else if (st.hours) parts.push(hmText(st.hours, lang));
  return { text: parts.join(' · '), st };
}
function rowHtml(x, lang, now) {
  const name = exitName(x, lang), alt = exitNameAlt(x, lang);
  const { text, st } = detailWords(x, lang, now);
  const closedNow = st.closed === 'now';
  const right = closedNow ? `<span class="rr"><small>${esc(st.opens ? tr(lang, 'exits.opens', { time: hmText(st.opens, lang) }) : tr(lang, 'exits.closed.now'))}</small></span>` : '';
  const off = st.known && !st.open;
  // the name says what the row prints too: facilities, hours, "closed now · opens 07:00"
  const label = [tr(lang, 'exits.show', { name }), text, closedNow ? (st.opens ? tr(lang, 'exits.opens', { time: hmText(st.opens, lang) }) : tr(lang, 'exits.closed.now')) : ''].filter(Boolean).join(', ');
  return `<button type="button" class="row tkx-row${off ? ' quiet' : ''}" data-exit="${esc(x.id)}" aria-label="${esc(label)}">`
    + `<span class="etile tkx-ic" aria-hidden="true">${x.kind === 'elevator' ? ELEV_SVG : EXIT_SVG}</span>`
    + `<span class="rt"><b>${esc(name)}${alt ? `<span class="tk-alt" lang="${L(lang) === 'ja' ? 'en' : 'ja'}">${esc(alt)}</span>` : ''}</b>${text ? `<span>${esc(text)}</span>` : ''}</span>${right}</button>`;
}
/**
 * The "Exits" section of a station sheet (HTML string; '' when the data has no exits for it or is not loaded yet; the
 * module fires 'tokyo:exits-ready' on window once loaded, so the page can render again).
 * key = complex index (model.groups) or { group, station }; opts.station = the picked station (its operator first),
 * opts.now = ms. Rows carry data-exit="<exit id>": mountExits handles the tap (fly to the exit at z18).
 */
export function exitsSection(key, lang = I.lang(), opts = {}, d = DATA) {
  if (!d) { if (typeof fetch === 'function' && typeof window !== 'undefined') loadExits(opts.base).catch(() => {}); return ''; }
  let k = typeof key === 'object' && key ? { ...key } : { group: key };
  if ((k.group == null || k.group < 0) && k.station != null) { const g0 = groupOfStation(k.station, d); if (g0 >= 0) k = { group: g0, station: k.station }; }
  const blocks = exitBlocks(k, { station: opts.station ?? k.station ?? null, lang }, d);
  if (!blocks.length) return '';
  const now = opts.now ?? Date.now();
  const sk = keyOf(k);
  const total = blocks.reduce((n, b) => n + b.exits.length, 0);
  const fold = total > ROWS_FOLDED + 2 && !expanded.has(sk);
  let left = fold ? ROWS_FOLDED : Infinity;
  const parts = [];
  for (const b of blocks) {
    if (left <= 0) break;
    const rows = b.exits.slice(0, left).map((x) => rowHtml(x, lang, now));
    left -= rows.length;
    parts.push(`${blocks.length > 1 || b.head ? `<p class="tkx-op">${esc(b.head)}</p>` : ''}<div class="list">${rows.join('')}</div>`);
  }
  const more = total > ROWS_FOLDED + 2
    ? `<button type="button" class="tkx-more" data-exit-more="${esc(sk)}" aria-expanded="${!fold}">${esc(fold ? tr(lang, 'exits.more', { n: total }) : tr(lang, 'exits.less'))}</button>` : '';
  const g = k.group != null && k.group >= 0 ? k.group : -1;
  const miss = (d.missing.get(g) || []).slice().sort((a, b) => a - b).map((o) => opTitle(d, o, lang)).filter(Boolean);
  const note = miss.length ? `<p class="kr-note tkx-note">${esc(tr(lang, 'exits.missing', { ops: miss.join(L(lang) === 'ja' ? '、' : ', ') }))}</p>` : '';
  ensureCss();
  return `<section class="sec tkx" data-exits="${esc(sk)}"><div class="sech"><h2>${esc(tr(lang, 'exits'))}</h2><small>${esc(trn(lang, 'exits.n', total))}</small></div>${parts.join('')}${more}${note}</section>`;
}

// ------------------------------------------------------------------ CSS (self-injected once, like BOARD_CSS)
export const EXITS_CSS = `
.tkx .tkx-op{margin:6px 2px -2px;font:600 13px/17px var(--font);color:var(--text2)}
.tkx .tkx-ic{color:var(--text)}
.tkx-g{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.tkx-g .f{fill:currentColor;stroke:none}
.tkx .tkx-more{justify-self:start;min-height:44px;padding:0 4px;font:600 15px/20px var(--font);color:var(--text)}
.tkx .tkx-note{margin:0 2px}
.tkx-card{position:absolute;left:0;top:0;z-index:6;display:flex;align-items:flex-start;gap:10px;width:max-content;max-width:min(300px,calc(100% - 24px));
  padding:10px 0 10px 10px;border-radius:16px;background:var(--bg,#fff);color:var(--text,#171717);box-shadow:0 6px 20px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.10);
  font:400 13px/17px var(--font,system-ui);pointer-events:auto}
.tkx-card .tkx-ic{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--elevated,#F2F2F3)}
.tkx-card .tkx-g{width:20px;height:20px}
.tkx-card .tkx-ct{display:grid;gap:1px;min-width:0;padding-top:1px}
.tkx-card .tkx-ct b{font:600 15px/20px var(--font,system-ui)}
.tkx-card .tkx-ct .tk-alt{display:block;margin:0;white-space:normal}
.tkx-card .tkx-ct span{color:var(--text2,#55555D)}
.tkx-card .tkx-ct .off{color:var(--text3,#8E8E96)}
.tkx-card .tkx-x{flex:none;width:44px;height:44px;margin:-8px 0 -8px -4px;display:grid;place-items:center;color:var(--text3,#8E8E96);background:none;border:0}
.tkx-card .tkx-x svg{width:16px;height:16px;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;fill:none}
`;
function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('tokyo-exits-css')) return;
  const el = document.createElement('style');
  el.id = 'tokyo-exits-css';
  el.textContent = EXITS_CSS;
  document.head.append(el);
}

// ------------------------------------------------------------------ the map layer
function iconImage(kind, { pick = false, off = false } = {}) {
  const pr = Math.max(2, Math.min(3, Math.ceil((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1)));
  const box = DISC + 4;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(box * pr);
  const g = c.getContext('2d');
  g.scale(pr, pr);
  const mid = box / 2;
  g.beginPath(); g.arc(mid, mid, DISC / 2 - 0.75, 0, Math.PI * 2);
  g.fillStyle = pick ? INK : '#FFFFFF'; g.fill();
  g.lineWidth = 1.5; g.strokeStyle = pick ? INK : off ? RING_OFF : RING; g.stroke();
  const s = (DISC * 0.66) / 24;
  g.save(); g.translate(mid - 12 * s, mid - 12 * s); g.scale(s, s);
  const ink = pick ? '#FFFFFF' : off ? GLYPH_OFF : GLYPH;
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round';
  if (kind === 'elevator') { g.stroke(new Path2D(ELEV_PATH)); g.fill(new Path2D(ELEV_FILL)); } else g.stroke(new Path2D(EXIT_PATH));
  g.restore();
  return [g.getImageData(0, 0, c.width, c.height), { pixelRatio: pr }];
}
const ICONS = { 'tk-exit-ic': ['exit', {}], 'tk-exit-ev': ['elevator', {}], 'tk-exit-off': ['exit', { off: true }], 'tk-exit-ev-off': ['elevator', { off: true }],
  'tk-exit-pk': ['exit', { pick: true }], 'tk-exit-ev-pk': ['elevator', { pick: true }] };

/**
 * Add the exits layer to a MapLibre map. opts: net (the network build model: station -> complex), lang, base (data URL),
 * data (an unpacked pack, skips the fetch), before (layer id to insert under; default style.js's 'tk-slabel'),
 * onPick(exit | null), now() -> ms. Returns { ready, showFor(g), showForStation(si), clear(), pick(x), fly(x),
 * setLang(l), nearest(lng, lat, opts), selected(), labels(), destroy() }; x = exit id or index.
 */
export function mountExits(map, opts = {}) {
  const net = opts.net || null;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  let lang = opts.lang || I.lang();
  let D = opts.data || null;
  let sel = new Set();          // exit indexes of the selected complex
  let selKey = null;
  let picked = -1;
  let card = null;
  let dead = false;
  const container = map.getContainer();
  const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  const index = (x) => {
    if (!D || x == null) return -1;
    if (typeof x === 'number') return D.exits[x] ? x : -1;
    const e = D.exits.find((y) => y.id === x);
    return e ? e.i : -1;
  };
  const props = (x) => {
    const st = exitState(x, now());
    const off = st.known && !st.open;
    const s = sel.has(x.i) ? 1 : 0;
    const k = (x.kind === 'elevator' ? 1 : 0) + (off ? 2 : 0);
    const r = (s ? 0 : 10000) + (off ? 5000 : 0) + (x.kind === 'elevator' ? 2000 : 0) + (x.code ? 1000 : 0) + (x.i % 1000);
    return { i: x.i, l: shortLabel(x, lang), k, s, r };
  };
  const features = () => ({ type: 'FeatureCollection', features: (D?.exits || []).map((x) => ({ type: 'Feature', id: x.i, geometry: { type: 'Point', coordinates: [x.lng, x.lat] }, properties: props(x) })) });
  const pickFeature = () => {
    const x = picked >= 0 ? D?.exits[picked] : null;
    return { type: 'FeatureCollection', features: x ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lng, x.lat] }, properties: { k: x.kind === 'elevator' ? 1 : 0 } }] : [] };
  };

  function addImages() {
    for (const [id, [kind, o]] of Object.entries(ICONS)) {
      if (map.hasImage?.(id)) continue;
      try { const [img, io] = iconImage(kind, o); map.addImage(id, img, io); } catch (e) { console.warn('[exits] icon', id, e); }
    }
  }
  function install() {
    if (dead || !D || !map.getStyle?.()) return;
    addImages();
    if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: features() });
    if (!map.getSource(PICK_SRC)) map.addSource(PICK_SRC, { type: 'geojson', data: pickFeature() });
    const before = opts.before !== undefined ? opts.before : (map.getLayer(LABELS_BEFORE) ? LABELS_BEFORE : undefined);
    const ja = L(lang) === 'ja';
    const size = ['interpolate', ['linear'], ['zoom'], Z_SEL, 0.8, Z_ALL, 0.95, 19, 1.1];
    if (!map.getLayer(L_DOT)) {
      map.addLayer({
        id: L_DOT, type: 'symbol', source: SRC, minzoom: Z_SEL,
        filter: ['any', ['==', ['get', 's'], 1], ['>=', ['zoom'], Z_ALL]],
        layout: {
          'icon-image': ['match', ['get', 'k'], 1, 'tk-exit-ev', 2, 'tk-exit-off', 3, 'tk-exit-ev-off', 'tk-exit-ic'],
          'icon-size': size, 'icon-allow-overlap': false, 'icon-ignore-placement': false, 'icon-padding': 1,
          'text-field': ['step', ['zoom'], '', Z_NAME, ['get', 'l']],
          'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], Z_NAME, ja ? 12.5 : 12, 19, ja ? 14.5 : 14],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-justify': 'auto',
          'text-max-width': 9, 'text-padding': 2, 'text-allow-overlap': false, 'text-ignore-placement': false, 'text-optional': true,
          'symbol-sort-key': ['get', 'r'],
        },
        paint: {
          'text-color': ['case', ['>=', ['get', 'k'], 2], TEXT_OFF, GLYPH],
          'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6, 'text-halo-blur': 0.2,
        },
      }, before && map.getLayer(before) ? before : undefined);
    }
    if (!map.getLayer(L_PICK)) {
      map.addLayer({
        id: L_PICK, type: 'symbol', source: PICK_SRC,
        layout: { 'icon-image': ['match', ['get', 'k'], 1, 'tk-exit-ev-pk', 'tk-exit-pk'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 19, 1.25],
          'icon-allow-overlap': true, 'icon-ignore-placement': false },
      }, before && map.getLayer(before) ? before : undefined);
    }
  }
  const refresh = () => { if (!dead && D && map.getSource(SRC)) map.getSource(SRC).setData(features()); };
  const refreshPick = () => { if (!dead && D && map.getSource(PICK_SRC)) map.getSource(PICK_SRC).setData(pickFeature()); };

  // the style can be reloaded (language, 3D): put the layer back
  const onStyle = () => { if (D && !map.getSource(SRC)) { try { install(); } catch (e) { console.warn('[exits] reinstall', e); } } };
  const onMissing = (e) => { const def = ICONS[e.id]; if (def) { try { const [img, io] = iconImage(def[0], def[1]); if (!map.hasImage(e.id)) map.addImage(e.id, img, io); } catch { /* ignore */ } } };
  map.on('styledata', onStyle);
  map.on('styleimagemissing', onMissing);

  if (D && !DATA) setExitsData(D);
  // the pack (35 KB br) is not part of the first load: it loads on the first station open (select,
  // or the sheet's exitsSection()), else once the page has been idle for 5 s. `ready` resolves when it is in.
  let started = false, idleT = 0, gotData;
  const arrived = new Promise((res) => { gotData = res; });
  const start = () => {
    if (started || dead) return;
    started = true;
    clearTimeout(idleT);
    (D ? Promise.resolve(D) : loadExits(opts.base)).then(gotData, (e) => { started = false; console.warn('[exits] data not loaded', e); });
  };
  const onDataReady = () => start();   // exitsSection() loaded it first
  if (D || opts.lazy === false) start();
  else {
    idleT = setTimeout(() => { if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 3000 }); else start(); }, 5000);
    try { window.addEventListener('tokyo:exits-ready', onDataReady); } catch { /* no window */ }
  }
  const ready = arrived.then((d) => {
    D = d;
    if (dead) return d;
    // the style may still be loading: install now if it can, else the next 'styledata' (onStyle) puts it in
    try { install(); if (selKey) select(selKey); } catch { map.once('load', onStyle); }
    // tell the page (again) that exits are in: it re-renders an open station sheet with its Exits section
    try { window.dispatchEvent(new CustomEvent('tokyo:exits-ready', { detail: { count: d.exits.length, layer: true } })); } catch { /* no window */ }
    return d;
  }).catch((e) => { console.warn('[exits] data not loaded', e); return null; });

  // ---------------------------------------------------------------- selection
  function select(key) {
    start();
    selKey = key;
    sel = new Set(D ? listFor(key, D) : []);
    refresh();
  }
  /** Exits of complex g (the network build model.groups index) from z15; -1 / null clears the selection. */
  function showFor(g) { if (g == null || g < 0) { selKey = null; sel = new Set(); refresh(); return 0; } select({ group: g }); return sel.size; }
  /** Exits of a station's complex (or of the station alone when it is in no complex). */
  function showForStation(si) {
    const g = net?.stations?.[si]?.group ?? groupOfStation(si, D);
    select(g != null && g >= 0 ? { group: g, station: si } : { station: si });
    return sel.size;
  }
  function clear() { selKey = null; sel = new Set(); picked = -1; closeCard(); watchPane(false); refresh(); refreshPick(); }

  // ---------------------------------------------------------------- pick: centre + a small card
  /** The part of the map no top bar or sheet/pane covers, in container px. */
  function visibleRect() {
    const mr = container.getBoundingClientRect();
    let top = 0, bottom = mr.height, left = 0, right = mr.width;
    try {
      const tb = document.getElementById('topbar')?.getBoundingClientRect();
      if (tb && tb.bottom - mr.top > 0 && tb.bottom - mr.top < bottom - 100) top = tb.bottom - mr.top;
      const pane = document.getElementById('pane')?.getBoundingClientRect();
      if (pane && pane.width > 0 && pane.height > 0) {
        if (pane.width >= mr.width * 0.9 && pane.top - mr.top > top + 120 && pane.top < mr.bottom) bottom = pane.top - mr.top;   // phone sheet
        else if (pane.left <= mr.left + 8 && pane.right < mr.right - 200) left = Math.max(left, pane.right - mr.left);              // desktop pane, left
        else if (pane.right >= mr.right - 8 && pane.left > mr.left + 200) right = Math.min(right, pane.left - mr.left);             // desktop pane, right
      }
    } catch { /* no DOM */ }
    return { top, bottom, left, right };
  }
  /** Camera offset that puts the target in the middle of the visible part (relative to the padded centre). */
  function visibleOffset() {
    try {
      const v = visibleRect(), c = map.project(map.getCenter());
      return [Math.round((v.left + v.right) / 2 - c.x), Math.round((v.top + v.bottom) / 2 - c.y)];
    } catch { return [0, 0]; }
  }
  /** A picked exit stays in sight: when the sheet settles over it (or the top bar hides it), ease it back into view. */
  function keepVisible() {
    if (dead || picked < 0 || !D || map.isMoving?.()) return;
    const e = D.exits[picked];
    const q = map.project([e.lng, e.lat]);
    const v = visibleRect(), m = 28;
    if (v.bottom - v.top < 140 || v.right - v.left < 160) return;   // the sheet is up: wait until it comes down
    if (q.y < v.top + m || q.y > v.bottom - m || q.x < v.left + m || q.x > v.right - m) {
      map.easeTo({ center: [e.lng, e.lat], offset: visibleOffset(), duration: reduce() ? 0 : 350 });
    }
  }
  let paneObs = null, paneTimer = 0;
  function watchPane(on) {
    const pane = typeof document !== 'undefined' ? document.getElementById('pane') : null;
    if (!on || !pane || typeof MutationObserver === 'undefined') { paneObs?.disconnect(); paneObs = null; clearTimeout(paneTimer); return; }
    if (paneObs) return;
    paneObs = new MutationObserver(() => { clearTimeout(paneTimer); paneTimer = setTimeout(keepVisible, 180); });
    paneObs.observe(pane, { attributes: true, attributeFilter: ['style'] });
  }
  function cardHtml(x) {
    const name = exitName(x, lang), alt = exitNameAlt(x, lang);
    const nm = D.names.get(x.station);
    const where = [nm ? (L(lang) === 'ja' ? nm.ja : nm.en) : '', opTitle(D, x.op, lang)].filter(Boolean).join(' · ');
    const { text, st } = detailWords(x, lang, now());
    const closed = st.closed === 'now' ? (st.opens ? tr(lang, 'exits.opens', { time: hmText(st.opens, lang) }) : tr(lang, 'exits.closed.now')) : '';
    return `<span class="tkx-ic" aria-hidden="true">${x.kind === 'elevator' ? ELEV_SVG : EXIT_SVG}</span>`
      + `<span class="tkx-ct"><b>${esc(name)}${alt ? `<span class="tk-alt" lang="${L(lang) === 'ja' ? 'en' : 'ja'}">${esc(alt)}</span>` : ''}</b>`
      + `${where ? `<span>${esc(where)}</span>` : ''}${text ? `<span>${esc(text)}</span>` : ''}${closed ? `<span class="off">${esc(closed)}</span>` : ''}</span>`
      + `<button type="button" class="tkx-x" aria-label="${esc(tr(lang, 'close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  }
  function placeCard() {
    if (!card || picked < 0 || !D) return;
    const x = D.exits[picked];
    const p = map.project([x.lng, x.lat]);
    const W = container.clientWidth, H = container.clientHeight;
    const w = card.offsetWidth, h = card.offsetHeight;
    let left = Math.round(p.x - w / 2), top = Math.round(p.y - h - 16);
    const tb = document.getElementById('topbar')?.getBoundingClientRect();
    const minTop = tb ? Math.max(8, tb.bottom - container.getBoundingClientRect().top + 6) : 8;
    if (top < minTop) top = Math.round(p.y + 16);
    left = Math.max(12, Math.min(W - w - 12, left));
    card.style.transform = `translate(${left}px, ${top}px)`;
    card.style.visibility = p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40 ? 'hidden' : 'visible';
  }
  function openCard() {
    if (!D || picked < 0) return;
    ensureCss();
    if (!card) {
      card = document.createElement('div');
      card.className = 'tkx-card';
      card.setAttribute('role', 'status');   // read once when an exit is picked (never focused: not a dialog)
      card.addEventListener('click', (e) => { if (e.target.closest('.tkx-x')) { e.stopPropagation(); unpick(); } });
      container.append(card);
    }
    const x = D.exits[picked];
    card.setAttribute('aria-label', exitName(x, lang));
    card.innerHTML = cardHtml(x);
    placeCard();
  }
  function closeCard() { if (card) { card.remove(); card = null; } }
  function unpick() { picked = -1; closeCard(); refreshPick(); watchPane(false); opts.onPick?.(null); }
  /** Pick an exit (id or index): dark disc + card; center = ease the map to it. */
  function pick(xi, { center = true } = {}) {
    const x = index(xi);
    if (x < 0) return null;
    picked = x;
    refreshPick();
    watchPane(true);
    const e = D.exits[x];
    if (center) map.easeTo({ center: [e.lng, e.lat], offset: visibleOffset(), duration: reduce() ? 0 : 450 });
    openCard();
    opts.onPick?.(e);
    return e;
  }
  /** Fly to an exit at z18 (the sheet's rows), pick it. */
  function fly(xi, { zoom = Z_FLY } = {}) {
    const x = index(xi);
    if (x < 0) return null;
    const e = D.exits[x];
    if (!sel.has(x)) select(e.group >= 0 ? { group: e.group } : { station: e.station });
    pick(x, { center: false });
    // the page may move its sheet out of the way (phones): it calls preventDefault() on this event once it snapped the
    // sheet down; the exit then goes to the map's padded centre, else to the middle of what the sheet leaves visible
    let moved = false;
    try { moved = !window.dispatchEvent(new CustomEvent('tokyo:exit-fly', { cancelable: true, detail: { id: e.id, lng: e.lng, lat: e.lat } })); } catch { /* no window */ }
    const z = Math.max(zoom, Math.min(map.getZoom(), 19));
    const camera = { center: [e.lng, e.lat], zoom: z, offset: moved ? [0, 0] : visibleOffset() };
    if (reduce()) map.jumpTo(camera); else map.flyTo({ ...camera, duration: 1400, essential: true });
    map.once('moveend', () => setTimeout(keepVisible, 60));   // the sheet may have moved during the flight
    return e;
  }

  // taps: capture on the map container, before MapLibre and the trains layer's own capture listener on the canvas
  const onTap = (ev) => {
    if (dead || !D || !map.getLayer(L_DOT)) return;
    if (ev.target?.closest?.('.tkx-card')) return;
    const canvas = map.getCanvas();
    if (ev.target !== canvas && !canvas.parentElement?.contains(ev.target)) return;   // a button over the map
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const r = 10;   // on the disc or its name, give or take a fingertip (station dots keep clear of exits by collision)
    let fs = [];
    try { fs = map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: [L_DOT] }); } catch { fs = []; }
    if (!fs.length) { if (picked >= 0) unpick(); return; }
    let best = null, bd = Infinity;
    for (const f of fs) {
      const e = D.exits[f.properties.i];
      if (!e) continue;
      const q = map.project([e.lng, e.lat]), dd = Math.hypot(q.x - x, q.y - y);
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation();
    pick(best.i, { center: true });
  };
  container.addEventListener('click', onTap, true);
  const onMove = () => placeCard();
  map.on('move', onMove);
  map.on('resize', onMove);
  // the sheet's rows: data-exit -> fly; data-exit-more -> unfold / fold the list in place
  const onDoc = (ev) => {
    const el = ev.target?.closest?.('[data-exit], [data-exit-more]');
    if (!el || dead) return;
    if (el.dataset.exitMore != null) {
      const k = el.dataset.exitMore;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      const sec = el.closest('section.tkx');
      if (sec && D) {
        const key = k[0] === 'g' ? { group: +k.slice(1) } : { station: +k.slice(1) };
        const html = exitsSection(key, lang, { now: now() }, D);
        if (html) sec.outerHTML = html;
      }
      return;
    }
    if (el.dataset.exit) fly(el.dataset.exit);
  };
  if (typeof document !== 'undefined') document.addEventListener('click', onDoc);
  // Escape with an exit picked: unpick only; capture + preventDefault so page.js's Escape (closes the station) skips it
  const onKey = (ev) => { if (ev.key === 'Escape' && picked >= 0) { ev.preventDefault(); unpick(); } };
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKey, true);
  // opening hours change during the day: redraw the closed state every 5 minutes
  const timer = setInterval(() => { refresh(); if (card) openCard(); }, 5 * 60e3);
  const offLang = typeof I.onLang === 'function' ? I.onLang((l) => setLang(l)) : null;

  function setLang(l) {
    if (!l || l === lang) return;
    lang = l;
    if (map.getLayer(L_DOT)) {
      const ja = L(lang) === 'ja';
      map.setLayoutProperty(L_DOT, 'text-size', ['interpolate', ['linear'], ['zoom'], Z_NAME, ja ? 12.5 : 12, 19, ja ? 14.5 : 14]);
    }
    refresh();
    if (card) openCard();
  }
  function destroy() {
    dead = true;
    clearInterval(timer);
    clearTimeout(idleT);
    try { window.removeEventListener('tokyo:exits-ready', onDataReady); } catch { /* no window */ }
    offLang?.();
    container.removeEventListener('click', onTap, true);
    if (typeof document !== 'undefined') { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey, true); }
    map.off('move', onMove); map.off('resize', onMove); map.off('styledata', onStyle); map.off('styleimagemissing', onMissing);
    closeCard();
    watchPane(false);
    for (const id of [L_PICK, L_DOT]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [PICK_SRC, SRC]) if (map.getSource(id)) map.removeSource(id);
  }

  return {
    ready, showFor, showForStation, clear, pick, fly, setLang, destroy,
    unpick, layers: EXIT_LAYERS.slice(),
    /** Exits of the current selection (objects). */
    selected: () => (D ? [...sel].map((x) => D.exits[x]) : []),
    picked: () => (picked >= 0 && D ? D.exits[picked] : null),
    nearest: (lng, lat, o) => nearestExit(lng, lat, o, D),
    /** The card (a DOM label over the map) for QA's overlap check: [{ kind: 'exit-card', text, x, y, w, h }]. */
    labels() {
      if (!card) return [];
      const r = card.getBoundingClientRect();
      return [{ kind: 'exit-card', text: card.getAttribute('aria-label') || '', x: r.left, y: r.top, w: r.width, h: r.height }];
    },
  };
}
