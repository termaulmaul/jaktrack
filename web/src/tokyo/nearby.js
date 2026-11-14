// "Trains near me". Walking around Tokyo with the page on a phone, the question asked most is "what trains leave near
// me, now?". This is a self-contained block for the home
// sheet that answers it.
//
// - Opt-in only. A "Trains near me" button (kereta's pill); the browser asks for the location on that tap, never on load. A
//   one-line privacy note: the location stays on this phone (it is only compared with station coordinates here,
//   never sent anywhere). After an opt-in, a later visit resumes only when the browser ALREADY grants the permission
//   (Permissions API 'granted': no prompt on load); "Turn off" forgets it.
// - The nearest 2-3 station complexes (model.groups) within 2 km in a straight line, with walking minutes (straight
//   line x 1.25 for the streets, 80 m a minute, rounded up: Japan's 徒歩 rule). Per complex and line, the next train
//   each way: time, countdown, train-type chip, destination (through-running included), live mark + delay when LIVE
//   measured one, last-train flag. The nearest platforms come first (lines ordered by distance in 100 m steps, then
//   board.js's JR / Metro / Toei / private order). The closest complex names its nearest exit (exits.js data).
// - watchPosition at low accuracy only while the home sheet is showing; stopped when another screen opens, the
//   search is in use or the tab is hidden (battery). The block redraws every 30 s on the clock (00 / :30), when
//   the phone has moved 25 m, and at once when the page clock jumps.
// - Location denied / unavailable / nothing within 2 km: a calm message and "Pick your station" (kereta's Stasiunku
//   flow: the page's data-act="change-home" opens the Stations tab), plus "Try again".
// - Tap a complex -> ctx.open('station', id) (the page shows board.js's station board and flies the map there); tap a
//   train -> ctx.open('train', runKey) (train-view.js's detail).
// Positions and times are the timetable's ("Scheduled") unless LIVE measured a delay for that run.
//
//   import { mountNearby } from './nearby.js';
//   const nb = mountNearby(el, {
//     model,        // model.js model (model.js createModel) or () => model (it may still be loading). Required.
//     open,         // (type, id) => void: 'station' + MT3D station id, 'train' + run key. Required for taps.
//     now,          // () => ms: the page clock (page.js NOW(), PLAYBACK-aware; default Date.now) or a fixed ms (tests)
//     visible,      // () => bool: the home sheet is what shows (default: #app[data-screen] is 'home' and #q is empty)
//     onLocation,   // ([lng, lat] | null, accuracyM) => void: e.g. the map's "you are here" dot (optional)
//     live,         // live.js's live object or () => it (optional: "Live data HH:MM" when a row is live)
//     dataBase,     // where /data/tokyo/ is served (exits.js's pack), default '/data/tokyo/'
//     say,          // (text) => void: the page's polite status line; said once when the cards arrive (optional)
//     idle,         // false or  => bool: false = no idle "Trains near me" row; the page's own near-me pill
//                   // calls nb.start() and the block shows from then on (until "Turn off"). Default true.
//     geo, storage, permissions,   // injectable for tests (default navigator.geolocation / localStorage / navigator.permissions)
//   });
//   el = an element the page never re-renders (the block owns its content and toggles el.hidden itself).
//   nb.start() (= the button) · nb.stop() (= Turn off) · nb.refresh() · nb.sync() (re-check visibility) ·
//   nb.state() (QA: { st, on, watching, fix, shown, complexes }) · nb.destroy()
//
// Pure parts (node tests): walkMinutes(m), nearComplexes(m, lng, lat, opts), nearbyData(m, lng, lat, ms, opts),
// renderNearby(view), NEARBY_CSS. Strings: i18n.js `// nearby.js keys` block ('nb.*') + board.js's 'board.for' /
// 'board.toward' / 'board.then' / 'board.gone' / 'board.first.next' and live.js's 'live.*'.

import { esc } from '../app/format.js';
import { icon } from '../app/ui.js';
import * as I from './i18n.js';
import { departures } from './model.js';
import { lineOrder, stationBoard, whereTo } from './board.js';
import { lineChip, typeChip, typeRank, viaText } from './types.js';

// ------------------------------------------------------------------ numbers
export const NEAR_MAX_M = 2000;   // straight line: nothing farther counts as "near me"
export const DETOUR = 1.25;       // streets are not straight lines (search.js uses the same factor)
export const WALK_M_MIN = 80;     // metres a minute (Japan's real-estate 徒歩 rule)
export const REFRESH_MS = 30000;  // redraw on the clock every 30 s
export const MOVE_M = 25;         // a new fix this far from the last drawn one redraws at once
export const LINES_FIRST = 6;     // lines shown for the closest complex (then "All n lines at X")
export const LINES_OTHER = 3;     // lines shown for the others
const STORE_KEY = 'tokyo.nearby';
const D2R = Math.PI / 180, R = 6371008.8;

/** Walking minutes for a straight-line distance in metres: x DETOUR, at WALK_M_MIN a minute, rounded up, >= 1. */
export const walkMinutes = (straightM) => Math.max(1, Math.ceil((straightM * DETOUR) / WALK_M_MIN));

/** Metres between two points (equirectangular; exact enough within a few km, as exits.js metres()). */
export function metres(lng1, lat1, lng2, lat2) {
  const k = Math.cos(((lat1 + lat2) / 2) * D2R);
  const dx = (lng2 - lng1) * k, dy = lat2 - lat1;
  return Math.sqrt(dx * dx + dy * dy) * D2R * R;
}

// ------------------------------------------------------------------ data (pure)
/** Station indexes of the complex s belongs to (model.groups), s itself when it stands alone. */
function complexIds(m, s) {
  const g = m.stations[s]?.group;
  const ids = g != null && g >= 0 && m.groups?.[g] ? m.groups[g] : [s];
  return ids.includes(s) ? ids : [s, ...ids];
}

/**
 * The n station complexes nearest to [lng, lat] within maxM metres (straight line), nearest first:
 * [{ s (its station nearest to you), g (model.groups index, -1 = a station on its own), ids (the complex), m (straight
 * metres), walkM (x DETOUR), walkMin }]. Stations without a coordinate (27 far-away MT3D ones) are skipped.
 */
export function nearComplexes(m, lng, lat, { n = 3, maxM = NEAR_MAX_M } = {}) {
  if (!m?.stations || !Number.isFinite(+lng) || !Number.isFinite(+lat)) return [];
  const best = new Map();   // complex key -> { s, d }
  const k = Math.cos(lat * D2R), cutX = maxM / (k * D2R * R), cutY = maxM / (D2R * R);
  for (let s = 0; s < m.stations.length; s++) {
    const st = m.stations[s];
    const x = st.lng, y = st.lat;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - lng) > cutX || Math.abs(y - lat) > cutY) continue;
    const d = metres(lng, lat, x, y);
    if (d > maxM) continue;
    const key = st.group != null && st.group >= 0 ? st.group : -1 - s;
    const b = best.get(key);
    if (!b || d < b.d || (d === b.d && s < b.s)) best.set(key, { s, d });
  }
  return [...best.entries()].sort((a, b) => a[1].d - b[1].d || a[1].s - b[1].s).slice(0, n).map(([key, { s, d }]) => ({
    s, g: key >= 0 ? key : -1, ids: complexIds(m, s), m: Math.round(d), walkM: Math.round(d * DETOUR), walkMin: walkMinutes(d),
  }));
}

/** One departure as the block shows it (expected time = timetable + measured delay, as model.js's departures()). */
function depOf(m, e, ms, g) {
  const dest = whereTo(m, e.run, e.stop);
  return {
    run: e.run, key: e.run.key ?? e.run.id, stop: e.stop, s: e.station, time: e.time, sched: e.sched ?? e.time, at: e.at,
    min: Math.floor((e.at - ms) / 60000), delay: e.delay || 0, live: !!e.live, type: e.run.type, line: e.line, dir: e.dir,
    to: dest.to, via: dest.via, loop: dest.loop, toward: dest.toward, name: dest.name,
    last: !!(g?.last && g.last.run === e.run && g.last.i === e.stop),
  };
}

/**
 * Everything the block shows for a position: { lng, lat, ms, complexes: [{ s, id, g, ids, name {en, ja}, others
 * [station index, one per other name], m, walkM, walkMin, known {first, last}, total (lines with trains today), lines: [{ line, id, m (straight
 * metres to that line's nearest station of the complex), ways: [{ key, dir, station, split, mixed, dep, then, gone,
 * firstNext }] }], exit: { name (short sign: 'A7a' / 'East Exit'), long, d } | null }] }. dep / then = { run, key, stop, s, time, sched, at, min, delay,
 * live, type, to, via, loop, toward, name, last } | null.
 * Ways come from board.js's stationBoard (every line and direction with a train in the loaded day, its last train, gone,
 * tomorrow's first); the next trains from model.js's departures() (live delays applied, a late train stays until it goes).
 * opts: n, maxM, exit(lng, lat, complex) -> { name, long, d } | null.
 */
export function nearbyData(m, lng, lat, ms = Date.now(), opts = {}) {
  const list = nearComplexes(m, lng, lat, opts);
  const complexes = list.map((c, ci) => {
    const b = stationBoard(m, c.s, ms, { per: 0 });
    const perLine = new Map();
    for (const x of b.ids) { const l = m.stations[x]?.line; perLine.set(l, (perLine.get(l) || 0) + 1); }
    const keyOf = (line, dir, station) => (perLine.get(line) > 1 ? `${line}|${dir}|${station}` : `${line}|${dir}`);
    const next = new Map();
    for (const e of departures(m, b.ids, ms, Infinity)) {
      const k = keyOf(e.line, e.dir, e.station);
      const a = next.get(k);
      if (!a) next.set(k, [e]); else if (a.length < 2) a.push(e);
    }
    // each line's nearest station of the complex: the nearest platforms come first
    const lineM = new Map();
    for (const x of b.ids) {
      const st = m.stations[x];
      if (!st || !Number.isFinite(st.lng)) continue;
      const d = metres(lng, lat, st.lng, st.lat);
      if (!lineM.has(st.line) || d < lineM.get(st.line)) lineM.set(st.line, d);
    }
    const byLine = new Map();
    for (const g of b.groups) {
      if (!byLine.has(g.line)) byLine.set(g.line, []);
      const a = next.get(g.key) || [];
      byLine.get(g.line).push({
        key: g.key, dir: g.dir, station: g.station, split: g.split, mixed: g.mixed,
        dep: a[0] ? depOf(m, a[0], ms, g) : null, then: a[1] ? depOf(m, a[1], ms, g) : null,
        gone: !a[0] && !!g.gone, firstNext: !a[0] && g.firstNext ? { time: g.firstNext.time, at: g.firstNext.at } : null,
      });
    }
    const lines = [...byLine.entries()].map(([line, ways]) => ({ line, id: m.lines[line]?.id, m: Math.round(lineM.get(line) ?? c.m), ways }))
      .sort((a, z) => Math.floor(a.m / 100) - Math.floor(z.m / 100) || lineOrder(m, a.line) - lineOrder(m, z.line));
    const st = m.stations[c.s];
    // the complex's other station names (Shinjuku-nishiguchi at Shinjuku): one station index per name
    const seen = new Set([st.name?.en]);
    const others = c.ids.filter((x) => { const n = m.stations[x]?.name?.en; if (!n || seen.has(n)) return false; seen.add(n); return true; });
    let exit = null;
    if (ci === 0 && typeof opts.exit === 'function') { try { exit = opts.exit(lng, lat, c) || null; } catch { exit = null; } }
    return { ...c, id: st.id, name: st.name, others, known: b.known, total: lines.length, lines, exit };
  });
  return { lng, lat, ms, complexes };
}

// ------------------------------------------------------------------ markup (pure)
const ja = () => I.lang() === 'ja';
const nm = (o) => I.title(o);
const stName = (m, s) => nm(m.stations[s]?.name);
const lnName = (m, l) => nm(m.lines[l]?.title);
const namesOf = (m, ids, sep) => [...new Set(ids.map((s) => stName(m, s)).filter(Boolean))].join(sep);
const distText = (d) => (d < 1000 ? `${Math.max(10, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1).replace('.', I.lang() === 'id' ? ',' : '.')} km`);
/** "For Osaki" / "For Shibuya, Shinagawa" (a loop train going on round) / "大崎行" (board.js's words). */
function destText(m, d) {
  if (d.loop && d.toward.length) return I.t('board.toward', { names: namesOf(m, d.toward, ja() ? '・' : ', ') });
  return I.t('board.for', { name: namesOf(m, d.to, ja() ? '・' : ' / ') });
}
const countText = (min) => (min <= 0 ? I.t('dep.now') : I.tn('min', min));
function liveText(d) {
  if (!d.live) return '';
  const late = Math.round(d.delay / 60);
  return late >= 1 ? I.t('live.late.short', { n: late }) : I.t('live.ontime');
}
const STATION_SVG = '<svg class="i kr-sg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8.5 20l1.8-3.5M15.5 20l-1.8-3.5"/></svg>';
const LOCK_SVG = '<svg class="nb-lock" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const altSpan = (o) => { const a = I.titleAlt(o); return a ? ` <span class="tk-alt" lang="${ja() ? 'en' : 'ja'}">${esc(a)}</span>` : ''; };

/** One way out as a tappable cell: time + countdown, destination (type chip first), then via / live / then.
 *  lineMixed: either way of this line mixes train types, so both cells carry their chip. */
function wayCell(m, line, w, walkMin, known, lineMixed = w.mixed) {
  const d = w.dep;
  if (!d) {
    const why = w.gone ? I.t('board.gone') : known?.last ? I.t('board.none.short') : I.t('board.loading');
    const first = w.firstNext ? I.t('board.first.next', { time: I.clock(w.firstNext.time) }) : '';
    return `<div class="nb-way nb-off"><span class="nb-wd">${esc(why)}</span>${first ? `<span class="nb-wx">${esc(first)}</span>` : ''}</div>`;
  }
  const dest = destText(m, d);
  const ty = m.types[d.type];
  const chip = ty && (lineMixed || w.mixed || typeRank(ty) > 0) ? `${typeChip(ty, I.lang())} ` : '';
  const cd = d.min < 60 ? countText(d.min) : '';
  const tight = d.min < walkMin;   // leaves before you could walk there: say what comes next
  const bits = [];
  if (d.via.length) bits.push(viaText(m.lines[d.via[0]], I.lang()));
  if (tight && w.then) bits.push(I.t('board.then', { time: I.clock(w.then.time) }));
  const lv = liveText(d);
  const live = lv ? `<span class="nb-live"${d.delay >= 60 ? ' data-late' : ''}>${esc(lv)}</span>` : '';
  const last = d.last ? `<span class="nb-last">${esc(I.t('board.last'))}</span>` : '';
  const label = [lnName(m, line), dest, ty ? nm(ty.title) : '', I.clock(d.time), cd, d.via.length ? viaText(m.lines[d.via[0]], I.lang()) : '',
    d.live ? `${I.t('live')} ${lv}` : I.t('sched'), d.last ? I.t('board.last') : '', tight && w.then ? I.t('board.then', { time: I.clock(w.then.time) }) : '']
    .filter(Boolean).join(', ');
  return `<button type="button" class="nb-way" data-nb-open="train" data-nb-id="${esc(d.key)}" aria-label="${esc(label)}">`
    + `<span class="nb-wt"><b>${esc(I.clock(d.time))}</b>${cd ? `<i${d.min <= 0 ? ' class="go"' : tight ? ' class="far"' : ''}>${esc(cd)}</i>` : ''}</span>`
    + `<span class="nb-wd">${chip}${esc(dest)}</span>`
    + `${live || last || bits.length ? `<span class="nb-wx">${live}${last}${bits.length ? `<span class="nb-bits">${esc(bits.join(' · '))}</span>` : ''}</span>` : ''}</button>`;
}

function complexCard(m, c, first) {
  const name = nm(c.name);
  const subBits = [I.t('nb.walk', { min: c.walkMin }), distText(c.walkM)];
  if (c.others.length) subBits.push(I.t('board.with', { names: namesOf(m, c.others, ja() ? '・' : ', ') }));
  const exit = c.exit ? `<span class="nb-exit">${esc(I.t('nb.exit', { name: c.exit.name }))}</span>` : '';
  const head = `<button type="button" class="row nb-sth" data-nb-open="station" data-nb-id="${esc(c.id)}" aria-label="${esc(`${name}, ${subBits.join(', ')}${c.exit ? `, ${I.t('nb.exit', { name: c.exit.name })}` : ''}. ${I.t('nb.board')}`)}">`
    + `<span class="etile kr-stile" aria-hidden="true">${STATION_SVG}</span><span class="rt"><b>${esc(name)}${altSpan(c.name)}</b><span>${esc(subBits.join(' · '))}</span>${exit}</span>${icon('chev', 'chev')}</button>`;
  const cap = first ? LINES_FIRST : LINES_OTHER;
  const shown = c.lines.slice(0, cap);
  const rows = shown.map((l) => {
    const line = m.lines[l.line];
    const mixed = l.ways.some((w) => w.mixed);
    return `<div class="nb-line" role="group" aria-label="${esc(lnName(m, l.line))}"><div class="nb-lh">${lineChip(line, I.lang(), { size: 'xs' })}<span>${esc(lnName(m, l.line))}</span></div>`
      + `<div class="nb-ways">${l.ways.map((w) => wayCell(m, l.line, w, c.walkMin, c.known, mixed)).join('')}</div></div>`;
  }).join('');
  const none = !c.lines.length ? `<p class="nb-none">${esc(c.known?.last ? I.t('station.none') : I.t('board.loading'))}</p>` : '';
  const more = c.lines.length > shown.length
    ? `<button type="button" class="kr-more nb-more" data-nb-open="station" data-nb-id="${esc(c.id)}">${esc(I.t('nb.more', { n: I.fmtNum(c.lines.length), name }))}${icon('chev', 'chev')}</button>` : '';
  return `<div class="nb-cx"><div class="nb-card">${head}${rows}${none}</div>${more}</div>`;
}

const privacy = (extra = '') => `<p class="nb-priv">${LOCK_SVG}<span>${esc(I.t('nb.priv'))}</span>${extra}</p>`;
const offBtn = () => `<button type="button" class="nb-link" data-nb="stop">${esc(I.t('nb.stop'))}</button>`;
const pickBtns = (retry = true) => `<div class="nb-acts"><button type="button" class="btn" data-act="change-home">${esc(I.t('my.pick'))}</button>${retry ? `<button type="button" class="btn" data-nb="start">${esc(I.t('retry'))}</button>` : ''}</div>`;
// the opt-in is kereta's pill with the locate glyph ("near me" is one component, the Home pill)
const askBtn = (label, busy = false) => `<button type="button" class="btn nb-btn" data-nb="${busy ? 'wait' : 'start'}"${busy ? ' aria-busy="true" aria-disabled="true"' : ''}>${icon('locate')}<span>${esc(label)}</span></button>`;

/**
 * The block's HTML for a view state: { st: 'idle' | 'wait' | 'ok' | 'far' | 'denied' | 'unavail' | 'nogeo' | 'insecure',
 * m (model.js model), data (nearbyData), acc (metres), liveAt (ms of the newest live data shown, or null) }.
 */
export function renderNearby(v) {
  const st = v?.st || 'idle';
  const head = (small = '') => `<div class="sech"><h2>${esc(I.t('nb.title'))}</h2>${small ? `<small>${esc(small)}</small>` : ''}</div>`;
  const wrap = (inner) => `<section class="sec nb" aria-label="${esc(I.t('nb.title'))}" data-nb-st="${st}">${inner}</section>`;
  if (st === 'idle') return wrap(`${askBtn(I.t('nb.go'))}${privacy()}`);
  if (st === 'wait') return wrap(`${askBtn(v.m ? I.t('nb.wait') : I.t('data.loading'), true)}<p class="nb-sub">${esc(I.t('nb.wait.sub'))}</p>${privacy(offBtn())}`);
  const msg = (title, body, retry = true, off = false) => wrap(`${head()}<div class="nb-msg" role="status"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}${pickBtns(retry)}</div>${privacy(off ? offBtn() : '')}`);
  if (st === 'insecure') return msg(I.t('loc.insecure'), I.t('nb.insecure.sub'), false);
  if (st === 'denied') return msg(I.t('nb.denied'), I.t('nb.denied.sub'));
  if (st === 'nogeo') return msg(I.t('nb.nogeo'), I.t('nb.pick.sub'), false);
  if (st === 'unavail') return msg(I.t('nb.unavail'), I.t('nb.pick.sub'), true, true);
  const cx = v.data?.complexes || [];
  if (st === 'far' || !cx.length) return msg(I.t('nb.far', { km: I.fmtNum(NEAR_MAX_M / 1000) }), I.t('nb.pick.sub'), true, true);
  const small = [I.t('sched'), I.t('jst'), v.liveAt ? I.t('live.updated', { time: I.clockMs(v.liveAt) }) : ''].filter(Boolean).join(' · ');
  const acc = v.acc > 300 ? `<span class="nb-acc">${esc(I.t('nb.acc', { dist: distText(v.acc) }))}</span>` : '';
  return wrap(`${head(small)}${cx.map((c, i) => complexCard(v.m, c, i === 0)).join('')}${privacy(`${acc}${offBtn()}`)}`);
}

// ------------------------------------------------------------------ styles (once)
export const NEARBY_CSS = `
.nb{gap:10px}
.nb-btn{justify-self:start;max-width:100%;min-width:0}
.nb-btn > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nb-btn[aria-busy="true"]{cursor:progress;color:var(--text2)}
.nb-sub{margin:-2px 0 0;font:400 13px/18px var(--font);color:var(--text2)}
.nb-priv{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;margin:0;font:400 13px/18px var(--font);color:var(--text2)}
.nb-lock{flex:none;width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round}
.nb-priv > span{min-width:0}
.nb-acc{color:var(--text2)}
.nb-link{display:inline-flex;align-items:center;min-height:44px;margin:-13px -6px -13px auto;padding:0 6px;background:none;font:600 13px/18px var(--font);color:var(--text);text-decoration:underline;text-underline-offset:2px}
.nb-cx{display:grid;gap:8px;min-width:0}
.nb-card{display:grid;border-radius:18px;background:var(--panel);overflow:hidden;min-width:0}
.nb-sth .rt > span{white-space:normal}
.nb-exit{font:400 13px/17px var(--font);color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nb-line{display:grid;gap:7px;padding:10px 12px 12px;border-top:.5px solid var(--border);min-width:0}
.nb-lh{display:flex;align-items:center;gap:8px;min-width:0;font:600 13px/18px var(--font);color:var(--text2)}
.nb-lh > span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nb-ways{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;min-width:0}
.nb-ways > :only-child{grid-column:1/-1}
.nb-way{display:grid;align-content:start;gap:2px;min-width:0;min-height:52px;padding:7px 10px 8px;border-radius:12px;background:var(--bg);color:var(--text);text-align:left;font:inherit}
button.nb-way:active{background:var(--elevated)}
.nb-way.nb-off{background:none;box-shadow:inset 0 0 0 1px var(--border)}
.nb-wt{display:flex;align-items:baseline;gap:6px;min-width:0}
.nb-wt b{flex:none;font:600 16px/21px var(--font);font-variant-numeric:tabular-nums}
.nb-wt i{margin-left:auto;flex:none;font:400 13px/18px var(--font);font-style:normal;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--text2)}
.nb-wt i.go{color:#157A39}
.nb-wt i.far{font-weight:400;color:var(--text2)}
.nb-wd{min-width:0;font:400 13px/17px var(--font);color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.nb-wd .tk-type{height:20px;padding:0 7px;font-size:13px;vertical-align:1px}
.nb-wx{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;min-width:0;font:400 13px/17px var(--font);color:var(--text2)}
.nb-bits{min-width:0;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.nb-live{display:inline-flex;align-items:center;gap:4px;flex:none;font:600 13px/17px var(--font);color:#157A39;white-space:nowrap}
.nb-live::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
.nb-live[data-late]{color:#B54708}
.nb-last{display:inline-flex;align-items:center;flex:none;height:18px;padding:0 6px;border-radius:999px;background:var(--warning-soft,#FEF0C7);color:#93370D;font:600 13px/1 var(--font);white-space:nowrap}
.nb-none{margin:0;padding:12px 14px 14px;border-top:.5px solid var(--border);font:400 13px/18px var(--font);color:var(--text2)}
.nb-msg{display:grid;gap:8px;padding:14px;border-radius:18px;background:var(--panel)}
.nb-msg b{font:600 15px/20px var(--font)}
.nb-msg > span{font:400 13px/18px var(--font);color:var(--text2)}
.nb-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.nb-acts .btn{height:44px;padding:0 16px;background:var(--bg);font-size:15px}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head) return;
  cssDone = true;
  if (document.getElementById('tk-nearby-css')) return;
  const el = document.createElement('style');
  el.id = 'tk-nearby-css';
  el.textContent = NEARBY_CSS;
  document.head.append(el);
}

// ------------------------------------------------------------------ the block (DOM, geolocation, timers)
const hasDoc = () => typeof document !== 'undefined' && !!document.getElementById;
function defaultVisible() {
  if (!hasDoc()) return true;
  const app = document.getElementById('app'), q = document.getElementById('q');
  const scr = app?.dataset?.screen;
  return (!scr || scr === 'home') && !String(q?.value || '').trim();
}
function safeStorage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

/**
 * Mount the block into `el` (see the file header for ctx). Nothing asks for the location until the button is tapped.
 */
export function mountNearby(el, ctx = {}) {
  if (!el) throw new Error('mountNearby: no element');
  ensureCss();
  const geo = ctx.geo !== undefined ? ctx.geo : (typeof navigator !== 'undefined' ? navigator.geolocation || null : null);
  const store = ctx.storage !== undefined ? ctx.storage : safeStorage();
  const perms = ctx.permissions !== undefined ? ctx.permissions : (typeof navigator !== 'undefined' ? navigator.permissions || null : null);
  const nowMs = () => (typeof ctx.now === 'function' ? ctx.now() : Number.isFinite(ctx.now) ? ctx.now : Date.now());
  const model = () => (typeof ctx.model === 'function' ? ctx.model() : ctx.model) || null;
  const liveObj = () => (typeof ctx.live === 'function' ? ctx.live() : ctx.live) || null;
  const docHidden = () => typeof document !== 'undefined' && !!document.hidden;
  const visible = () => !docHidden() && (typeof ctx.visible === 'function' ? !!ctx.visible() : defaultVisible());
  // idle false (or a function answering false) = no "Trains near me" row of its own: the page's one near-me
  // entry (Home's card pill) calls start(); the block shows from that tap on and hides again after "Turn off"
  const secure = () => (ctx.secure !== undefined ? !!(typeof ctx.secure === 'function' ? ctx.secure() : ctx.secure) : (typeof window === 'undefined' || window.isSecureContext !== false));
  const idleRow = () => (typeof ctx.idle === 'function' ? !!ctx.idle() : ctx.idle !== false);
  const showing = (vis = visible()) => vis && (S.st !== 'idle' || idleRow());
  const S = { st: 'idle', on: false, watch: null, fix: null, drawnAt: null, data: null, shown: null, timer: null, moveTimer: null,
    modelTimer: null, lastCalc: 0, calcNow: NaN, html: '', gone: false };
  const remember = (on) => { try { if (on) store?.setItem(STORE_KEY, '1'); else store?.removeItem(STORE_KEY); } catch { /* storage blocked: this visit only */ } };
  const remembered = () => { try { return store?.getItem(STORE_KEY) === '1'; } catch { return false; } };

  // the closest complex's nearest exit, once its pack is in
  let EX = null, exTried = false;
  function wantExits() {
    if (EX || exTried) return;
    exTried = true;
    if (ctx.exits === false) return;   // jaktrack: the page knows the exits pack was not built: no fetch, no 404 in the console
    import('./exits.js').then(async (mod) => {
      if (!mod?.nearestExit) return;
      if (!mod.exitsData?.()) { try { await mod.loadExits?.(ctx.dataBase || '/data/tokyo/'); } catch { /* no exit data: no line */ } }
      EX = mod;
      if (!S.gone && S.st === 'ok') refresh();
    }).catch(() => { /* EXITS not in this build */ });
  }
  const exitOf = (lng, lat, c) => {
    if (!EX?.exitsData?.()) return null;
    const r = EX.nearestExit(lng, lat, c.g >= 0 ? { group: c.g, max: 1500 } : { station: c.s, max: 1500 });
    // the sign's short form: 'A7a' for a numbered exit, else its name ('East Exit' / '東口')
    return r ? { name: (EX.shortLabel || EX.exitName)(r.exit, I.lang()), long: EX.exitName(r.exit, I.lang()), d: Math.round(r.d) } : null;
  };

  // ---- drawing
  function liveAtOf(data) {
    const lv = liveObj();
    if (!lv || typeof lv.updatedAt !== 'function' || !data) return null;
    let at = null;
    for (const c of data.complexes) for (const l of c.lines) if (l.ways.some((w) => w.dep?.live)) {
      try { const x = lv.updatedAt(l.id); if (Number.isFinite(x) && (at == null || x > at)) at = x; } catch { /* fine */ }
    }
    return at;
  }
  function draw() {
    if (S.gone) return;
    const m = model();
    const html = renderNearby({ st: S.st, m, data: S.data, acc: S.fix?.acc, liveAt: S.st === 'ok' ? liveAtOf(S.data) : null });
    const show = showing();
    if (el.hidden !== !show) el.hidden = !show;
    if (html === S.html) return;
    // keep the keyboard where it was across a redraw
    let sel = null;
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    const had = !!a && !!el.contains?.(a);
    if (had) {
      const d = a.dataset || {};
      sel = d.nbOpen ? `[data-nb-open="${d.nbOpen}"][data-nb-id="${cssEsc(d.nbId || '')}"]` : d.nb ? `[data-nb="${d.nb}"]` : d.act ? `[data-act="${d.act}"]` : null;
    }
    S.html = html;
    el.innerHTML = html;
    if (!had) return;
    // the focused control may be gone ("Trains near me" -> the busy button -> the cards; a train that left):
    // the block's first control takes it (the first station row reads "Shibuya, 1 min walk, ..."), never <body>
    let to = null;
    try { to = sel ? el.querySelector?.(sel) : null; } catch { to = null; }
    if (!to && show) { try { to = el.querySelector?.('.nb-sth, .nb-msg .btn, [data-nb="wait"], [data-nb="start"]'); } catch { to = null; } }
    // the block hid itself (idle false + "Turn off"): back to the page's near-me pill that started it
    if (!to && !show) { try { to = document.querySelector?.('#view [data-act="locate"]'); } catch { to = null; } }
    try { to?.focus?.({ preventScroll: true }); } catch { /* fine */ }
  }
  /** Work out the data again (position or clock changed) and draw. */
  function refresh() {
    if (S.gone) return;
    const m = model();
    if (S.on && S.fix && m) {
      try {
        S.calcNow = nowMs();
        S.data = nearbyData(m, S.fix.lng, S.fix.lat, S.calcNow, { exit: exitOf });
        const was = S.st;
        S.st = S.data.complexes.length ? 'ok' : 'far';
        // one polite line when the cards arrive after the tap (ctx.say = the page's #tk-say; optional)
        if (S.st !== was && (was === 'wait' || was === 'unavail')) {
          try { ctx.say?.(S.st === 'ok' ? `${I.t('nb.title')}: ${S.data.complexes.map((c) => nm(c.name)).join(', ')}` : I.t('nb.far', { km: I.fmtNum(NEAR_MAX_M / 1000) })); } catch { /* fine */ }
        }
        S.drawnAt = { lng: S.fix.lng, lat: S.fix.lat };
        if (S.st === 'ok') wantExits();
      } catch (e) { console.warn('[tokyo] nearby', e); }
      S.lastCalc = Date.now();
    } else if (S.on && !S.fix && S.st !== 'unavail') S.st = 'wait';
    else if (S.on && S.fix && !m) {   // a fix before the timetable is in: look again in a second
      S.st = 'wait';
      if (!S.modelTimer) { S.modelTimer = setTimeout(() => { S.modelTimer = null; refresh(); }, 1000); S.modelTimer?.unref?.(); }
    }
    draw();
  }
  /** The page's clock jumped (playback.js picked another time, or went back to now): work the trains out again. */
  function clockJumped() {
    if (!S.on || !S.data || !Number.isFinite(S.calcNow)) return false;
    return Math.abs((nowMs() - S.calcNow) - (Date.now() - S.lastCalc)) > 20000;
  }

  // ---- the clock: every 30 s on :00 / :30 while showing
  function schedule() {
    if (S.timer || S.gone) return;
    const wait = REFRESH_MS - (nowMs() % REFRESH_MS) + 40;
    S.timer = setTimeout(() => { S.timer = null; if (S.shown && S.on) { refresh(); schedule(); } }, wait);
    S.timer?.unref?.();
  }
  function unschedule() {
    for (const k of ['timer', 'moveTimer', 'modelTimer']) if (S[k]) { clearTimeout(S[k]); S[k] = null; }
  }

  // ---- geolocation
  function onFix(p) {
    if (S.gone || !S.on) return;
    const c = p?.coords || {};
    const lng = +c.longitude, lat = +c.latitude;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    S.fix = { lng, lat, acc: Number.isFinite(+c.accuracy) ? +c.accuracy : null, at: nowMs() };
    try { ctx.onLocation?.([lng, lat], S.fix.acc); } catch { /* fine */ }
    const far = S.drawnAt ? metres(S.drawnAt.lng, S.drawnAt.lat, lng, lat) : Infinity;
    if (far < MOVE_M && S.st === 'ok') return;
    // at most one redraw every 4 s while walking (low-accuracy fixes can come quickly); a jump of 200 m+ (a coarse
    // fix replaced by a good one) shows at once
    const since = Date.now() - S.lastCalc;
    if (S.st !== 'ok' || since >= 4000 || far >= 200) refresh();
    else if (!S.moveTimer) { S.moveTimer = setTimeout(() => { S.moveTimer = null; refresh(); }, 4000 - since); S.moveTimer?.unref?.(); }
  }
  function onErr(e) {
    if (S.gone || !S.on) return;
    if (e?.code === 1) {   // PERMISSION_DENIED: stop, forget the opt-in, offer the station picker
      stopWatch(); S.on = false; remember(false); S.st = 'denied'; S.fix = null; S.data = null;
      try { ctx.onLocation?.(null, 0); } catch { /* fine */ }
      draw(); return;
    }
    // unavailable / timeout: the watch keeps trying; with no fix yet say so (calmly) and offer the picker
    if (!S.fix) { S.st = 'unavail'; draw(); }
  }
  function startWatch() {
    if (S.watch != null || !geo?.watchPosition) return;
    try {
      S.watch = geo.watchPosition(onFix, onErr, { enableHighAccuracy: false, maximumAge: 30000, timeout: 27000 });
    } catch (e) { S.watch = null; onErr({ code: 2, message: String(e?.message || e) }); }
  }
  function stopWatch() {
    if (S.watch == null) return;
    try { geo?.clearWatch?.(S.watch); } catch { /* fine */ }
    S.watch = null;
  }

  // ---- showing / hidden
  function sync() {
    if (S.gone) return;
    const vis = visible();
    const show = showing(vis);
    if (el.hidden !== !show) el.hidden = !show;
    const flipped = vis !== S.shown;
    S.shown = vis;
    if (vis && S.on) startWatch(); else stopWatch();
    if (!vis || !S.on) unschedule(); else schedule();
    if (vis && (flipped || clockJumped())) refresh();
  }

  // ---- the button and the other taps
  function start() {
    if (S.gone) return;
    // jaktrack: plain http on a LAN address: the browser refuses without asking, so say that instead of "denied"
    if (!secure()) { S.on = false; S.st = 'insecure'; draw(); sync(); return; }
    if (!geo?.watchPosition) { S.on = false; S.st = 'nogeo'; draw(); sync(); return; }
    S.on = true; remember(true);
    if (!S.fix) S.st = 'wait';
    draw();
    stopWatch();   // "Try again": a fresh watch
    if (visible()) startWatch();
    sync();
    refresh();
  }
  function stop() {
    if (S.gone) return;
    stopWatch(); unschedule();
    S.on = false; S.fix = null; S.data = null; S.drawnAt = null; S.st = 'idle'; remember(false);
    try { ctx.onLocation?.(null, 0); } catch { /* fine */ }
    draw(); sync();
  }
  function onClick(e) {
    const b = e.target?.closest?.('[data-nb], [data-nb-open]');
    if (!b || !el.contains?.(b)) return;
    if (b.dataset.nb === 'start') { e.preventDefault?.(); start(); return; }
    if (b.dataset.nb === 'stop') { e.preventDefault?.(); stop(); return; }
    if (b.dataset.nbOpen && b.dataset.nbId) {
      e.preventDefault?.();
      try { ctx.open?.(b.dataset.nbOpen, b.dataset.nbId); } catch (err) { console.warn('[tokyo] nearby open', err); }
    }
  }
  el.addEventListener?.('click', onClick);

  // ---- triggers for sync(): screen changes, search typing, tab hidden, language
  const offs = [];
  const on = (target, type, fn, opts) => { if (!target?.addEventListener) return; target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
  if (typeof document !== 'undefined') {
    on(document, 'visibilitychange', sync);
    on(document, 'input', (e) => { if (e.target?.id === 'q') sync(); });
  }
  if (typeof window !== 'undefined') { on(window, 'popstate', sync); on(window, 'hashchange', sync); }
  if (typeof MutationObserver === 'function' && hasDoc()) {
    const mo = new MutationObserver(() => sync());
    const app = document.getElementById('app'), view = document.getElementById('view');
    if (app) mo.observe(app, { attributes: true, attributeFilter: ['data-screen', 'data-detail'] });
    if (view) mo.observe(view, { childList: true });
    offs.push(() => mo.disconnect());
  }
  offs.push(I.onLang(() => { S.html = ''; refresh(); }));

  // ---- a remembered opt-in resumes only when the browser already allows it (no prompt on load)
  if (remembered() && geo?.watchPosition && perms?.query) {
    Promise.resolve().then(() => perms.query({ name: 'geolocation' })).then((p) => {
      if (S.gone || S.on || p?.state !== 'granted') return;
      S.on = true; S.st = 'wait'; draw(); sync();
    }).catch(() => { /* no Permissions API answer: wait for the tap */ });
  }

  draw();
  sync();

  return {
    start, stop, refresh, sync,
    state: () => ({ st: S.st, on: S.on, watching: S.watch != null, fix: S.fix ? { ...S.fix } : null, shown: S.shown,
      complexes: (S.data?.complexes || []).map((c) => ({ id: c.id, name: c.name?.en, walkMin: c.walkMin, m: c.m, lines: c.lines.length, exit: c.exit?.name || null })) }),
    destroy() {
      S.gone = true; stopWatch(); unschedule();
      el.removeEventListener?.('click', onClick);
      for (const f of offs.splice(0)) { try { f(); } catch { /* fine */ } }
    },
  };
}
const cssEsc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
