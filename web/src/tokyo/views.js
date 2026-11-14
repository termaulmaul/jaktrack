// the app's boards as HTML strings:
// the home (trains running now per operator, My station), the Lines tab (each line's rhythm), a station complex's board
// (per line and direction the next trains, with through-running destinations and the last train), the first and last
// trains, a line's rhythm block. Built from board.js over model.js's model; every dynamic value goes through esc(); every
// screen that shows times or trains says "Scheduled". Times are WIB, rounded down to the minute;
// countdowns in whole minutes and only under an hour. Strings: i18n.js (board.js keys block).
//
// page.js mounts these through laneView(): every view gets page.js's ctx first ({sim (model.js's model), home, art, disc, ...}):
//   homeView(ctx)  linesView(ctx)  stationView(ctx, stationId)  myStation(ctx, stationId)
//   rhythmBlock(ctx, lineId) and firstLastBlock(ctx, stationId) are pieces for other screens (train-view.js's line view).
// Taps use the page's attributes: data-station=<station id>, data-train=<run key>, data-line=<line id>,
// data-act="save" data-id=<station id>, data-act="change-home", data-act="locate", data-home=<station id>, data-tab.

import { esc } from '../app/format.js';
import { icon } from '../app/ui.js';
import { clock, clockMs, fmtNum, lang, locale, t, title, titleAlt, tn } from './i18n.js';
import { lineChip, opName, typeChip as typesChip, typeRank, viaText } from './types.js';
import {
  CHIPS, chipOf, complexLines, complexOf, coverage, firstLast, isGenericDir, lineOrder, lineRhythm, myStation as myStationData, nextFirst,
  operatorOf, runningByOperator, serviceTime, stationBoard,
} from './board.js';
import { suspendedOf } from './model.js';

// ------------------------------------------------------------------ the board's own CSS (once, on first import)
export const BOARD_CSS = `
.tb-line{display:grid;gap:8px;min-width:0}
.tb-lh{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:0 2px;background:none;color:var(--text);text-align:left}
.tb-lh b{font:700 16px/21px var(--font);letter-spacing:-.01em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-lh small{flex:none;margin-left:auto;font:400 13px/17px var(--font);color:var(--text3)}
.tb-lh .chev{flex:none;width:16px;height:16px;color:var(--text3)}
.tb-last{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;background:var(--warning-soft,#FEF0C7);color:#93370D;font:600 11.5px/1 var(--font);white-space:nowrap}
.tb-dep .rt b{white-space:normal}
.tb-dep .tk-type,.tb-mini .tk-type{margin-right:2px}
.tb-wx .tk-type{height:20px;padding:0 7px;margin-right:4px;font-size:13px;vertical-align:1px}
.tb-dep .rt > span{white-space:normal}
.tb-dep .rt > .tb-lastl{display:flex;margin:2px 0 1px}
.tb-dep .rr{gap:4px}
.row.tb-dep .rr .cd.go,.tb-my .row.tb-mini .rr .cd.go,.tb-way i.go{color:#157A39}
.tb-dep .kr-tm.tb-exp,.tb-way b.late{color:#B54708}
.tb-dep .kr-tm s{display:block;font:400 13px/16px var(--font);color:var(--text2)}
.tb-lv.on i,.tb-ldot{display:inline-block;flex:none;width:7px;height:7px;margin-right:5px;border-radius:50%;background:var(--income);vertical-align:1px}
.tb-ldot{align-self:center;margin-right:-2px}
.tb-late{color:#B54708;font-weight:600}
.tb-fl,.row .rr.tb-fl{display:flex;gap:14px}
.tb-fl span{display:grid;justify-items:end;min-width:44px}
.tb-fl small{font:400 13px/16px var(--font);color:var(--text3)}
.tb-fl b{font:600 15px/20px var(--font);font-variant-numeric:tabular-nums}
.tb-flr .rt > span,.tb-flr .rt b{white-space:normal}
.tb-line .kr-dgh{flex-wrap:wrap;row-gap:0}
.tb-line .kr-dgh b{white-space:normal}
.tb-my{display:grid;border-radius:18px;background:var(--panel);overflow:hidden;min-width:0}
.tb-myl{display:flex;align-items:center;gap:8px;padding:10px 14px 0;font:600 13px/18px var(--font);color:var(--text2);min-width:0}
.tb-myl .rtile.krl-bullet{width:24px;height:24px;box-shadow:inset 0 0 0 3.2px var(--rc)}
.tb-myl .rtile.krl-bullet b{font-size:11px}
.tb-myl .rtile.krl-bullet[data-len="2"] b{font-size:8.5px}
.tb-myl .rtile.krl-bullet[data-len="3"] b{font-size:6.5px}
.tb-myl + .row::before{display:none}
.tb-mini{min-height:56px;padding-left:14px}
.tb-mini + .tb-myl{border-top:.5px solid var(--border);margin-top:2px}
.tb-mini .rt b,.tb-mini .rt > span{white-space:normal}
.tb-my .row.tb-mini .rr .cd{font:400 13px/17px var(--font);font-variant-numeric:tabular-nums;white-space:nowrap}
.tb-my .row.tb-mini .rr .cd:not(.go){color:var(--text2)}
.tb-st,.tb-board{display:grid;gap:14px;min-width:0}
.tb-chips{min-width:0}
.tb-chip{gap:6px;padding:0 14px 0 6px;min-width:44px;justify-content:center}
.tb-chip:first-child{padding-left:14px}
.tb-chip .tk-lc{flex:none}
.tb-chip[aria-pressed="true"] .tk-lc{box-shadow:0 0 0 1.5px rgba(255,255,255,.9)}
.tb-sum{align-items:flex-start;padding-top:12px;padding-bottom:12px}
.tb-sum .rt{gap:3px}
.tb-sum .rt > b{white-space:normal}
.tb-way{display:flex;align-items:baseline;gap:8px;min-width:0;font:400 13.5px/19px var(--font);color:var(--text2)}
.tb-way b{flex:none;font:600 14px/19px var(--font);color:var(--text);font-variant-numeric:tabular-nums}
.tb-wx{flex:1;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.tb-sum .rt > .tb-way{white-space:normal}
.tb-way i{flex:none;font:400 13px/19px var(--font);font-style:normal;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
.tb-way .tb-last{align-self:center;height:18px;padding:0 6px;font-size:11px}
.tb-wx .tb-last{vertical-align:1px}
.tb-wx:has(.tb-last){-webkit-line-clamp:3}
.tb-sum .chev{align-self:center}
.tb-route{font-weight:600}
.tb-sev{flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:-3px;margin-right:5px}
:is(.tb-notice,.tb-svcrow,.tb-svc,.tb-wsev,.tb-sevbit){--sev:var(--text2)}
:is(.tb-notice,.tb-svcrow,.tb-svc,.tb-wsev,.tb-sevbit)[data-sev="info"]{--sev:var(--info,#175CD3)}
:is(.tb-notice,.tb-svcrow,.tb-svc,.tb-wsev,.tb-sevbit)[data-sev="delay"]{--sev:#B54708}
:is(.tb-notice,.tb-svcrow,.tb-svc,.tb-wsev,.tb-sevbit)[data-sev="suspended"]{--sev:var(--danger,#D92D20)}
.tb-sev{color:var(--sev,currentColor)}
.tb-notice{display:flex;align-items:flex-start;gap:4px;margin:0;padding:10px 12px;border-radius:14px;background:var(--panel);font:400 13px/18px var(--font);color:var(--text)}
.tb-notice[data-sev="delay"],.tb-notice[data-sev="suspended"]{background:color-mix(in srgb,var(--sev) 9%,var(--panel))}
.tb-notice .tb-sev{margin-top:1px}
.tb-nt{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tb-nt b{font-weight:600}
.tb-nt small{color:var(--text3)}
.tb-asof{flex:none;margin-left:6px;font:400 13px/18px var(--font);color:var(--text3);white-space:nowrap}
.tb-mynote{padding:6px 10px 2px}
.tb-mynote + .row::before{display:none}
.tb-wsev{color:var(--text)}
.tb-wsev b{font-weight:600}
.tb-svcrow{align-items:flex-start}
.tb-svcrow .rt > b{display:flex;align-items:center;white-space:normal}
.tb-svcrow .rt > span{white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;color:var(--text)}
.tb-svcrow .rt > small{font:400 13px/17px var(--font);color:var(--text3)}
.tb-svc{display:flex;align-items:flex-start;gap:6px;padding:12px 14px;border-radius:18px;background:var(--panel);font:400 13px/18px var(--font);color:var(--text2)}
.list + .tb-svc{margin-top:8px}
.tb-svc .tb-sev{margin-top:1px}
.tb-svc b{display:block;font:600 14px/19px var(--font);color:var(--text)}
.tb-sevbit{color:var(--text);font-weight:600}
.tb-opt[data-op="JR-Central"]{box-shadow:inset 0 0 0 2px #F77321}
.tb-opt{display:inline-flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;border-radius:50%;background:var(--elevated);color:var(--text);font:700 13px/1 var(--font);letter-spacing:-.02em}
`;
if (typeof document !== 'undefined' && !document.getElementById('tokyo-board-css')) {
  const el = document.createElement('style');
  el.id = 'tokyo-board-css';
  el.textContent = BOARD_CSS;
  document.head.append(el);
}

// ------------------------------------------------------------------ helpers
const ja = () => lang() === 'ja';
const nm = (o) => title(o);
const sep = () => (ja() ? '・' : ', ');
const stName = (m, s) => nm(m.stations[s]?.name);
const lnName = (m, l) => nm(m.lines[l]?.title);
const names = (m, ids, j = sep()) => [...new Set(ids.map((s) => stName(m, s)).filter(Boolean))].join(j);
const altSpan = (o) => { const a = titleAlt(o); return a ? `<span class="tk-alt" lang="${ja() ? 'en' : 'ja'}">${esc(a)}</span>` : ''; };

// station / line ids <-> indexes (the page routes by MT3D id; the model works in indexes)
const ids = new WeakMap();
function idx(m) {
  let x = ids.get(m);
  if (!x) ids.set(m, x = { station: new Map(m.stations.map((s, i) => [s.id, i])), line: new Map(m.lines.map((l, i) => [l.id, i])) });
  return x;
}
const stationIndex = (m, id) => (typeof id === 'number' ? id : idx(m).station.get(id) ?? null);
const lineIndex = (m, id) => (typeof id === 'number' ? id : idx(m).line.get(id) ?? null);

/** The model.js model the views read (ctx.sim from page.js; tests may pass the model itself as ctx). */
const modelOf = (ctx) => ctx?.sim || (ctx?.runById ? ctx : null);

/** A line's ring bullet (page.js's disc when the page passes it; the same markup otherwise). */
function disc(ctx, l) {
  if (!l) return '';
  if (typeof ctx?.disc === 'function') return ctx.disc(l);
  const c = l.code || (nm(l.title) || l.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '·';
  return `<span class="rtile krl-bullet" style="--rc:${esc(l.color || '#6B6B70')}" data-len="${Math.min(3, c.length)}" aria-hidden="true"><b>${esc(c)}</b></span>`;
}
const STATION_SVG = '<svg class="i kr-sg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8.5 20l1.8-3.5M15.5 20l-1.8-3.5"/></svg>';
const stationTile = () => `<span class="etile kr-stile" aria-hidden="true">${STATION_SVG}</span>`;
const STAR = '<svg class="kr-star" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3.5Z"/></svg>';

const sec = (head, small, body) => `<section class="sec"><div class="sech"><h2>${esc(head)}</h2>${small ? `<small>${esc(small)}</small>` : ''}</div>${body}</section>`;
const list = (rows) => `<div class="list">${rows.join('')}</div>`;
const note = (html) => `<p class="kr-note">${html}</p>`;
function placeHead({ lead, titleHtml, sub = '', close = true }) {
  return `<div class="ph" data-drag>${lead}<div class="rt"><h2>${titleHtml}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${close ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(t('close'))}">${icon('x')}</button>` : ''}</div>`;
}
function countdown(min) {
  if (min == null || min >= 60 || min < 0) return '';
  return `<span class="cd${min <= 1 ? ' go' : ''}">${esc(min <= 0 ? t('dep.now') : tn('min', min))}</span>`;
}
/** A departure's live words: measured = "Live position · 2 min late" (+ the live dot), live.js's estimate =
 * "Estimated · about 2 min late" (never "live", no dot), null = the timetable (the screen says Scheduled). */
let liveNow = null;   // the page's live layer for the view being drawn (views draw synchronously; set by boardBlock / myStation)
function liveBit(d) {
  if (!d.live && !d.est) return null;
  const n = Math.max(0, Math.round((d.delay || 0) / 60));
  if (d.live) {
    // a report without a delay figure (Toei trams, or a source that reports only a place): its time is moved by the lag read
    // from where it was reported, but the words claim no minutes
    let fig = 0;
    try { fig = typeof liveNow?.delayOf === 'function' ? liveNow.delayOf(d.run) : 0; } catch { fig = 0; }
    if (fig == null) return { live: true, n: 0, head: t('tv.live'), late: '' };
    return { live: true, n, head: t('tv.live'), late: n ? t('tv.live.late', { n }) : t('tv.live.ontime') };
  }
  return { live: false, n, head: '', late: t('board.est', { late: n ? t('live.est.late', { n }) : t('live.est.ontime') }) };
}
const liveText = (b) => (b ? [b.head, b.late].filter(Boolean).join(' · ') : '');
function liveHtml(b) {
  if (!b) return '';
  if (!b.live) return `<span class="tb-lv">${esc(b.late)}</span>`;
  const late = !b.late ? '' : b.n ? ` · <span class="tb-late">${esc(b.late)}</span>` : ` · ${esc(b.late)}`;
  return `<span class="tb-lv on"><i aria-hidden="true"></i>${esc(b.head)}${late}</span>`;
}
/** The expected time moved off the timetable minute by a delay (the board shows both). */
const shifted = (d) => d.sched != null && Math.floor(d.time / 60) !== Math.floor(d.sched / 60);

/** The calendar's name ("Saturday and holiday") and, on a weekday public holiday, the note that says so. */
function calendarNote(m, ms) {
  const c = serviceTime(ms);
  const cal = m.calendar || c.calendar;
  const calText = t(`cal.${cal}`) !== `cal.${cal}` ? t(`cal.${cal}`) : cal || '';
  let holiday = '';
  if (cal === 'holiday' && c.weekday >= 1 && c.weekday <= 5) {
    const date = new Date(c.start + 12 * 3600000).toLocaleDateString(locale(), { day: 'numeric', month: ja() ? 'long' : 'short', timeZone: 'Asia/Jakarta' });
    holiday = ` ${t('board.holiday', { date })}`;
  }
  return `${esc(t('board.note', { cal: calText }))}${esc(holiday)}`;
}

// ------------------------------------------------------------------ directions, destinations, train types
/** A direction's name: MT3D's title in JA and EN ("For Shibuya", "Inner Loop"), the Indonesian words in ID. */
function dirLabel(m, d) {
  const dir = m.dirs[d];
  if (!dir) return '';
  if (ja()) return dir.title?.ja || dir.title?.en || dir.id;
  const en = dir.title?.en || dir.id;
  if (isGenericDir(m, d)) return lang() === 'id' ? t(`board.dir.${dir.id}`) : en;
  return t('board.dir.for', { name: en.replace(/^For\s+/i, '') });
}
/** The station a 'For X' direction names (English), '' for generic ones. */
const dirStation = (m, d) => (isGenericDir(m, d) ? '' : (m.dirs[d]?.title?.en || '').replace(/^For\s+/i, ''));
/** A board group's header: the direction, and where generic ("Inbound", "Inner Loop") the big stations it goes for. */
function groupLabel(m, g) {
  const d = dirLabel(m, g.dir);
  const at = g.split ? ` · ${t('board.at.st', { name: stName(m, g.station) })}` : '';
  if (g.loop || !g.generic || !g.toward.length) return d + at;
  return t('board.dir.toward', { dir: d, names: names(m, g.toward) }) + at;
}
/** "For Osaki" / "For Shibuya, Shinagawa" (a loop train carrying on round) / "Motomachi-Chukagai行". */
function destText(m, d) {
  if (d.loop && d.toward.length) return t('board.toward', { names: names(m, d.toward) });
  return t('board.for', { name: names(m, d.to, ja() ? '・' : ' / ') });
}
/** The train type as types.js's round chip. Locals show only where that way also has faster trains (a Yamanote or
 * Ginza board is all locals: no chip on every row). */
function typeChip(m, y, mixed = true) {
  const ty = m.types[y];
  if (!ty || (!mixed && typeRank(ty) === 0)) return '';
  return `${typesChip(ty, lang())} `;
}
const viaLine = (m, l) => viaText(m.lines[l], lang());
/** A train's own name ("Narita Express 18" / 成田エクスプレス18号) in the page language; a plain string as is. */
const runName = (x) => (x && typeof x === 'object' ? nm(x) : String(x || ''));
/** An operator's name: short in EN / ID (Keio, Toei), the usual Japanese name in JA. */
const opText = (op) => (ja() && op.id === 'TokyoMetro' ? '東京メトロ' : opName(op, lang(), true) || nm(op.title) || op.id);

/** Where a departing train is now, in a few words (only for departures within the next 45 minutes). */
function whereText(m, d, here) {
  const w = d.where, r = d.run;
  if (d.from != null && (!w || w.state === 'before' || w.state === 'wait')) return t('board.from.line', { line: lnName(m, d.from) });
  if (!w) return '';
  const atHere = (s) => here.has(s);
  if (w.state === 'before') {
    const s0 = r.stops[0].s;
    return atHere(s0) ? t('board.where.here') : t('board.where.before', { name: stName(m, s0), time: clock(r.stops[0].d ?? r.stops[0].a) });
  }
  if (w.state === 'wait') { const s0 = r.stops[0].s; return atHere(s0) ? t('board.where.platform') : t('board.where.at', { name: stName(m, s0) }); }
  if (w.state === 'at') { const s = r.stops[w.stop].s; return atHere(s) ? t('board.where.platform') : t('board.where.at', { name: stName(m, s) }); }
  if (w.state === 'between' && w.from != null && w.to != null) return `${stName(m, w.from)} → ${stName(m, w.to)}`;
  return '';
}

// ------------------------------------------------------------------ service status (運行情報) from LIVE
// What riders check first. live.js's live.js turns the operators' ODPT train information into status(lineId) =
// {severity, text {ja, en?}, at, op, line, resume?}; today the keyless Toei feed (6 lines), more operators with ODPT
// keys. Shown only where a line has a status: lines without a source are never called "normal". The operator's
// Japanese stays as given; EN / ID get the feed's English or live.js's line for its known fixed sentences, else the
// Japanese marked "Notice in Japanese only" (never our translation). Severity = an icon AND a word, never colour alone.
// The data time (ODPT dc:date) is shown as "as of HH:MM".
const liveOf = (ctx) => ctx?.live ?? (typeof globalThis !== 'undefined' ? globalThis.__tokyo?.live : null) ?? null;
const SEV_RANK = { suspended: 3, delay: 2, info: 1, normal: 0 };
const sevOf = (st) => (st && SEV_RANK[st.severity] != null ? st.severity : 'info');
const SEV_SVG = {
  normal: '<circle cx="10" cy="10" r="7.5"/><path d="m6.6 10.2 2.3 2.3 4.6-4.8"/>',
  info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9.2v4.6M10 6.4h.01"/>',
  delay: '<path d="M10 2.9 17.8 16.6H2.2L10 2.9Z"/><path d="M10 8v3.9M10 14h.01"/>',
  suspended: '<path d="M7 2.6h6l4.4 4.4v6L13 17.4H7L2.6 13V7Z"/><path d="M6.6 10h6.8"/>',
};
const sevIcon = (sev) => `<svg class="tb-sev" viewBox="0 0 20 20" aria-hidden="true">${SEV_SVG[sev] || SEV_SVG.info}</svg>`;
/** live.js's status of line l (index), or null (no source, LIVE off, data too old). */
function statusOf(ctx, m, l) {
  const lv = liveOf(ctx);
  if (!lv || typeof lv.status !== 'function' || !m.lines[l]) return null;
  try { return lv.status(m.lines[l].id) || null; } catch { return null; }
}
function dataTime(ctx, m, l) {
  const lv = liveOf(ctx);
  try { const v = lv?.updatedAt?.(m.lines[l].id); return Number.isFinite(v) ? v : null; } catch { return null; }
}
/** The operator's words for this reader: {text, lang, only} (only = Japanese shown to an EN / ID reader). */
function statusWords(st) {
  const tx = st?.text || {};
  if (ja()) return { text: tx.ja || tx.en || '', lang: tx.ja ? 'ja' : 'en', only: false };
  if (tx.en) return { text: tx.en, lang: 'en', only: false };
  return { text: tx.ja || '', lang: 'ja', only: !!tx.ja };
}
/** One line over a line's rows on the boards: icon + severity word + the operator's words (clamped) + as of. */
function noticeLine(ctx, m, l) {
  const st = statusOf(ctx, m, l);
  if (!st || st.severity === 'normal') return '';
  const sev = sevOf(st), w = statusWords(st), at = dataTime(ctx, m, l);
  return `<p class="tb-notice" data-sev="${sev}">${sevIcon(sev)}<span class="tb-nt"><b>${esc(t(`live.sev.${sev}`))}</b>${w.only ? ` <small>(${esc(t('live.ja.only'))})</small>` : ''} <span lang="${w.lang}">${esc(w.text)}</span></span>${at ? `<small class="tb-asof">${esc(t('board.asof', { time: clockMs(at) }))}</small>` : ''}</p>`;
}

/**
 * The home's "Service status": the affected lines first (worst first: line ring + severity + the operator's words +
 * as of), then one quiet line for the lines running normally, then which operators have status data at all.
 * Nothing when no line has a status (LIVE off, no keys): the timetable pages say Scheduled anyway.
 */
function serviceBlock(ctx, m) {
  const lv = liveOf(ctx);
  if (!lv || typeof lv.status !== 'function') return '';
  const ops = new Map();   // operator id -> {op, lines, normal}
  const bad = [];          // [{l, st}] line notices, or one per operator-wide notice
  const seen = new Set();
  let newest = null;
  for (let l = 0; l < m.lines.length; l++) {
    const st = statusOf(ctx, m, l);
    if (!st) continue;
    const op = operatorOf(m, l);
    if (!ops.has(op.id)) ops.set(op.id, { op, lines: 0, normal: 0 });
    const o = ops.get(op.id);
    o.lines++;
    const at = dataTime(ctx, m, l);
    if (at && (!newest || at > newest)) newest = at;
    if (st.severity === 'normal') { o.normal++; continue; }
    if (seen.has(st)) continue;    // an operator-wide notice: once
    seen.add(st);
    bad.push({ l, st, opWide: !st.line });
  }
  if (!ops.size) return '';
  const opNames = (list0) => list0.map((o) => opText(o.op)).join(sep());
  bad.sort((a, b) => SEV_RANK[sevOf(b.st)] - SEV_RANK[sevOf(a.st)] || lineOrder(m, a.l) - lineOrder(m, b.l));
  const rows = bad.map(({ l, st, opWide }) => {
    const line = m.lines[l], sev = sevOf(st), w = statusWords(st), at = dataTime(ctx, m, l);
    const who = opWide ? opText(operatorOf(m, l)) : lnName(m, l);
    const lead = opWide ? opTile(operatorOf(m, l).id, operatorOf(m, l).title) : lineChip(line, lang(), { size: 'sm' });
    const resume = Number.isFinite(st.resume) ? ` ${t('live.resume', { time: clockMs(st.resume) })}` : '';
    const label = `${who}: ${t(`live.sev.${sev}`)}. ${w.text}${resume}`;
    const attrs = opWide ? '' : ` data-line="${esc(line.id)}"`;
    const tag = opWide ? 'div' : 'button';
    return `<${tag}${tag === 'button' ? ' type="button"' : ''} class="row tb-svcrow" data-sev="${sev}"${attrs} aria-label="${esc(label)}">${lead}<span class="rt"><b>${sevIcon(sev)}${esc(`${who} · ${t(`live.sev.${sev}`)}`)}</b><span lang="${w.lang}">${esc(w.text + resume)}</span>${w.only ? `<small>${esc(t('live.ja.only'))}</small>` : ''}</span>${at ? `<span class="rr"><small>${esc(clockMs(at))}</small></span>` : ''}</${tag}>`;
  });
  const okOps = [...ops.values()].filter((o) => o.normal > 0);
  const okText = !bad.length ? t('board.svc.normal', { ops: opNames(okOps) }) : okOps.length ? t('board.svc.others', { ops: opNames(okOps) }) : '';
  // with live positions on (any source, as the map draws them) the card never says
  // "other operators: timetable only": notices stay the status operators', and a link opens the Live now sheet
  // (which lines are live; the page's data-act="sched"). No operator or source list here.
  let anyLive = false;
  try { for (const run of lv.measured || []) { if (Number.isInteger(run?.line) && m.lines[run.line]) { anyLive = true; break; } } } catch { anyLive = false; }
  const coverHtml = anyLive
    ? `${esc(t('board.svc.cover.live', { ops: opNames([...ops.values()]) }))} <button type="button" class="kr-link" data-act="sched">${esc(t('board.svc.livelink'))}</button>`
    : esc(t('board.svc.cover', { ops: opNames([...ops.values()]) }));
  const quiet = okText ? `<div class="tb-svc" data-sev="normal">${sevIcon('normal')}<span><b>${esc(okText)}</b><span>${coverHtml}</span></span></div>`
    : `<p class="kr-note">${coverHtml}</p>`;
  const small = newest ? t('board.asof', { time: clockMs(newest) }) : '';
  return sec(t('board.svc'), small, `${rows.length ? list(rows) : ''}${quiet}`);
}

// ------------------------------------------------------------------ station board pieces
/** One departure, the time first (時刻 · 種別 · 行先): type chip + destination, through-running, where the train is now,
 * countdown and the last-train flag. */
function depRow(m, d, here, mixed = true, own = null) {
  const dest = destText(m, d);
  const bits = [];
  // a complex of several names (Shinjuku + Shinjuku-nishiguchi): say which station the train leaves from
  if (own != null && stName(m, d.s) !== stName(m, own)) bits.push(t('board.at.st', { name: stName(m, d.s) }));
  if (d.via.length) bits.push(viaLine(m, d.via[0]));
  if (d.name) bits.push(runName(d.name));
  const where = whereText(m, d, here);
  if (where) bits.push(where);
  const flag = d.last ? `<span class="tb-last">${esc(t('board.last'))}</span>` : d.lastTo ? `<span class="tb-last">${esc(t('board.last.for', { name: names(m, d.to, ja() ? '・' : ' / ') }))}</span>` : '';
  const cd = countdown(d.min);
  const lb = liveBit(d), moved = shifted(d);
  const label = [clock(d.time), moved ? `${t('tv.timetable')} ${clock(d.sched)}` : '', dest, nm(m.types[d.type]?.title), d.via.length ? viaLine(m, d.via[0]) : '', liveText(lb), d.min >= 0 && d.min < 60 ? (d.min <= 0 ? t('dep.now') : tn('min', d.min)) : '', d.last ? t('board.last') : ''].filter(Boolean).join(', ');
  // a late (or early) train: the expected time, the timetable's struck under it
  const tm = moved ? `<span class="kr-tm tb-exp">${esc(clock(d.time))}<s>${esc(clock(d.sched))}</s></span>` : `<span class="kr-tm">${esc(clock(d.time))}</span>`;
  const sub = lb || bits.length ? `<span>${liveHtml(lb)}${lb && bits.length ? ' · ' : ''}${esc(bits.join(' · '))}</span>` : '';
  // the last-train badge under the destination, the countdown alone on the right (the badge clipped the destination)
  return `<button type="button" class="row kr-brow tb-dep" data-train="${esc(d.run.key ?? d.run.id)}" aria-label="${esc(label)}">
    ${tm}<span class="rt"><b>${typeChip(m, d.type, mixed)}${esc(dest)}</b>${flag ? `<span class="tb-lastl">${flag}</span>` : ''}${sub}</span><span class="rr">${cd}</span></button>`;
}

/** A line and direction leaving the complex: its header, the next trains, and the last train of the day. */
function dirGroup(m, g, here, per = 3, known = { last: true }, own = null) {
  const head = `<div class="kr-dgh"><b>${esc(groupLabel(m, g))}</b>${g.next != null && !g.gone ? `<small>${esc(t('board.next.stop', { name: stName(m, g.next) }))}</small>` : ''}</div>`;
  const rows = g.deps.slice(0, per).map((d) => depRow(m, d, g.split ? new Set([g.station]) : here, g.mixed, g.split ? null : own)).join('');
  let foot = '';
  if (g.gone) {
    foot = `<div class="kr-dgf"><span>${esc(t('board.gone'))}</span><b>${esc(clock(g.last.time))}</b></div>`;
    if (g.firstNext) foot += `<div class="kr-dgf"><span>${esc(`${t('board.first.tomorrow')} · ${destText(m, g.firstNext)}`)}</span><b>${esc(clock(g.firstNext.time))}</b></div>`;
  } else if (g.last && !g.deps.some((d) => d.last)) {
    foot = `<div class="kr-dgf"><span>${esc(t('board.last.to', { name: g.last.loop ? names(m, g.last.toward) : names(m, g.last.to, ja() ? '・' : ' / ') }))}</span><b>${esc(clock(g.last.time))}</b></div>`;
  }
  return `<section class="kr-dg" aria-label="${esc(`${lnName(m, g.line)}, ${groupLabel(m, g)}`)}">${head}
    ${rows || (g.gone ? '' : `<p class="kr-none">${esc(known.last ? t('board.none') : t('board.loading'))}</p>`)}${foot}</section>`;
}

/** After the last train of every way out: the night picture, and when tomorrow's first trains are known. */
function nightCard(ctx, m, s, b) {
  const last = b.groups.map((g) => g.last).sort((a, c) => c.time - a.time)[0];
  const known = b.groups.some((g) => g.firstNext);
  const art = ctx?.art?.tidur;
  return `<div class="kr-night">${art ? `<img src="${esc(art)}" width="84" height="84" alt="" draggable="false" decoding="async">` : '<span></span>'}
    <div><b>${esc(t('board.night.t'))}</b><span>${esc(t('board.night.s', { name: stName(m, s), time: last ? clock(last.time) : '–' }))}${ja() ? '' : ' '}${esc(known ? t('board.night.first') : t('board.night.cal'))}</span></div></div>`;
}
const complexTitle = (m, s) => [...new Set(complexOf(m, s).map((x) => stName(m, x)).filter(Boolean))].join(ja() ? '・' : ' / ');
/** The complex's other station names ("Shinjuku-nishiguchi" at Shinjuku), '' when they all share the name. */
const otherNames = (m, s) => [...new Set(complexOf(m, s).map((x) => stName(m, x)).filter((n) => n && n !== stName(m, s)))].join(sep());

/** One line's block on a station board: the line (tap: its line view), then each direction. */
function lineBlock(ctx, m, l, groups, here, per, known, own) {
  const line = m.lines[l];
  const op = operatorOf(m, l);
  return `<section class="tb-line" aria-label="${esc(lnName(m, l))}"><button type="button" class="tb-lh" data-line="${esc(line.id)}">${disc(ctx, line)}<b>${esc(lnName(m, l))}</b><small>${esc(opText(op))}</small>${icon('chev', 'chev')}</button>
    ${noticeLine(ctx, m, l)}${groups.map((g) => dirGroup(m, g, here, per, known, own)).join('')}</section>`;
}

// ------------------------------------------------------------------ a station (complex) board
// Big complexes (Shinjuku: 11 lines, 19 ways out) open on a summary: one row per line with the next train each way;
// a tap on a row or on the line chips above shows that line's full board in place, the others stay a row each. The
// choice is kept per station for this tab (sessionStorage; memory when storage is blocked). Self-contained: the view
// handles its own taps (one delegated listener, below), the page wires nothing.
const BIG = 5;            // lines at a complex from which the board opens on the summary
const SEL_KEY = 'tokyo.board.line';
const selMem = new Map();
function readSel(stationId) {
  try {
    const all = JSON.parse(sessionStorage.getItem(SEL_KEY) || '{}');
    if (Object.prototype.hasOwnProperty.call(all, stationId)) return all[stationId] || null;
  } catch { /* storage blocked: memory only */ }
  return selMem.get(stationId) ?? null;
}
function writeSel(stationId, lineId) {
  selMem.set(stationId, lineId || null);
  try {
    const all = JSON.parse(sessionStorage.getItem(SEL_KEY) || '{}');
    if (lineId) all[stationId] = lineId; else delete all[stationId];
    sessionStorage.setItem(SEL_KEY, JSON.stringify(all));
  } catch { /* storage blocked: memory only */ }
}
/** The line (index) the board of station `st` shows, or null (all lines: the summary on big complexes). */
function selectedLine(m, st, lines, opts) {
  const want = opts.line !== undefined ? opts.line : readSel(st.id);
  const l = want == null || want === '' ? null : lineIndex(m, want);
  return l != null && lines.includes(l) ? l : null;
}
/** A line's short name for the chips: "Yamanote" (EN / ID drop " Line"), 山手線 (JA). */
const lineShort = (m, l) => (ja() ? lnName(m, l) : lnName(m, l).replace(/\s+Line$/i, ''));

/** The chips over a complex's board: All + every line (types.js's ring), one scrolling row, 44 px targets. */
function lineChips(m, lines, sel, boardId) {
  const chip = (lineId, pressed, inner, label) => `<button type="button" class="chip tb-chip" data-tbl="${esc(lineId)}" aria-pressed="${pressed}" aria-controls="${boardId}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`;
  return `<div class="chips tb-chips" role="group" aria-label="${esc(t('station.lines'))}">${chip('', sel == null, esc(t('board.lines.all')), '')}${lines.map((l) => chip(m.lines[l].id, sel === l, `${lineChip(m.lines[l], lang(), { size: 'xs' })}<span>${esc(lineShort(m, l))}</span>`, lnName(m, l))).join('')}</div>`;
}

/** A line as one summary row: its ring, its name, and per way the next train (time, where it goes, countdown).
 * The way itself reads from the destination ("For Ikebukuro, Nippori"); the full board names the directions. */
function summaryRow(ctx, m, l, groups, known, own = null) {
  const line = m.lines[l];
  const mixed = groups.some((g) => g.mixed);   // one chip rule per row: either way mixes types -> both ways name theirs
  const ways = groups.map((g) => {
    const d = g.deps[0];
    const label = groupLabelShort(m, g);
    // a line with two stations in the complex: the other station's ways say where they leave from
    const at = g.split && stName(m, g.station) !== stName(m, own) ? ` · ${t('board.at.st', { name: stName(m, g.station) })}` : '';
    if (!d) {
      const why = g.gone ? (g.firstNext ? `${t('board.first.tomorrow')} ${clock(g.firstNext.time)}` : t('board.gone')) : (known.last ? t('board.none.short') : t('board.loading'));
      return { html: `<span class="tb-way"><span class="tb-wx">${esc(`${label}: ${why}`)}</span></span>`, text: `${label}: ${why}` };
    }
    const cd = d.min >= 0 && d.min < 60 ? (d.min <= 0 ? t('dep.now') : tn('min', d.min)) : '';
    // live: the dot before the expected time (late = the delay colour); the words are in the row's label
    const lb = liveBit(d);
    return {
      // the train type as on the full rows (in the rush Express vs Local decides whether it stops here;
      // types.js's chip, exact colours; an all-local way stays quiet: no chip)
      html: `<span class="tb-way">${lb?.live ? '<span class="tb-ldot" aria-hidden="true"></span>' : ''}<b${shifted(d) ? ' class="late"' : ''}>${esc(clock(d.time))}</b><span class="tb-wx">${typeChip(m, d.type, mixed)}${d.name ? `${esc(runName(d.name))} · ` : ''}${esc(destText(m, d) + at)}${d.last ? ` <span class="tb-last">${esc(t('board.last'))}</span>` : ''}</span>${cd ? `<i${d.min <= 1 ? ' class="go"' : ''}>${esc(cd)}</i>` : ''}</span>`,
      text: `${label}, ${clock(d.time)} ${[mixed || typeRank(m.types[d.type] || {}) > 0 ? nm(m.types[d.type]?.title) : '', d.name ? runName(d.name) : '', destText(m, d)].filter(Boolean).join(' ')}${lb ? `, ${liveText(lb)}` : ''}${cd ? `, ${cd}` : ''}${d.last ? `, ${t('board.last')}` : ''}`,
    };
  });
  const st = statusOf(ctx, m, l);
  const sev = st && st.severity !== 'normal' ? sevOf(st) : null;
  const sw = sev ? statusWords(st) : null;
  const notice = sev ? `<span class="tb-way tb-wsev" data-sev="${sev}">${sevIcon(sev)}<span class="tb-wx"><b>${esc(t(`live.sev.${sev}`))}</b> <span lang="${sw.lang}">${esc(sw.text)}</span></span></span>` : '';
  const sevText = sev ? `${t(`live.sev.${sev}`)}: ${sw.text}. ` : '';
  return `<button type="button" class="row tb-sum" data-tbl="${esc(line.id)}" aria-label="${esc(`${lnName(m, l)}: ${sevText}${ways.map((w) => w.text).join('; ')}`)}">${disc(ctx, line)}<span class="rt"><b>${esc(lnName(m, l))}</b>${notice}${ways.map((w) => w.html).join('')}</span>${icon('chev', 'chev')}</button>`;
}
/** A way's short name (aria labels): the direction, plus the station where the line has two in the complex. */
function groupLabelShort(m, g) {
  return g.split ? `${dirLabel(m, g.dir)} · ${stName(m, g.station)}` : dirLabel(m, g.dir);
}

/** Words for a suspended line (model.js SUSPENDED: operator notice, e.g. Isumi): "Service suspended · replacement buses". */
const suspWords = (e) => t(e?.bus ? 'line.suspended' : 'line.suspended.nobus');
/** A suspended line on a board: its head (opens the line view) + ONE calm line instead of departures. */
function suspBlock(ctx, m, l) {
  const line = m.lines[l];
  return `<section class="tb-line" aria-label="${esc(lnName(m, l))}"><button type="button" class="tb-lh" data-line="${esc(line.id)}">${disc(ctx, line)}<b>${esc(lnName(m, l))}</b><small>${esc(opText(operatorOf(m, l)))}</small>${icon('chev', 'chev')}</button>
    <p class="tb-notice" data-sev="suspended">${sevIcon('suspended')}<span class="tb-nt"><b>${esc(suspWords(suspendedOf(m, l)))}</b></span></p></section>`;
}

/** The board block: one line in full (+ the other lines as summary rows), the summary, or every line in full. */
function boardBlock(ctx, m, s, sel, ms) {
  liveNow = liveOf(ctx);
  const lines = complexLines(m, s);
  const b = stationBoard(m, s, ms, { per: 3 });
  const here = new Set(b.ids);
  const byLine = new Map(lines.map((l) => [l, []]));
  for (const g of b.groups) byLine.get(g.line)?.push(g);
  const has = [...byLine.entries()].filter(([, gs]) => gs.length);
  // suspended lines draw no trains (model.js leaves their runs out): one calm line each, after the running ones
  const calm = lines.filter((l) => suspendedOf(m, l)).map((l) => suspBlock(ctx, m, l)).join('');
  if (!has.length) return calm || `<p class="kr-none">${esc(t('station.none'))}</p>`;
  const night = b.allGone ? nightCard(ctx, m, s, b) : '';
  const rows = (list0) => list0.map(([l, gs]) => summaryRow(ctx, m, l, gs, b.known, s));
  if (sel != null && byLine.get(sel)?.length) {
    const others = has.filter(([l]) => l !== sel);
    return `${night}${lineBlock(ctx, m, sel, byLine.get(sel), here, 3, b.known, s)}
      ${firstLastSection(ctx, m, s, ms, sel, b.allGone)}
      ${others.length ? sec(t('board.other.lines'), t('sched'), list(rows(others))) : ''}${calm}`;
  }
  if (lines.length >= BIG) return `${night}${sec(t('station.next'), t('sched'), list(rows(has)))}${calm}`;
  return `${night}${has.map(([l, gs]) => lineBlock(ctx, m, l, gs, here, 3, b.known, s)).join('')}${calm}${firstLastSection(ctx, m, s, ms, null, b.allGone)}`;
}

let boardCtx = null;   // the last ctx a station view was drawn with: for its own taps (filter, route)
/** The page clock at a tap after the view was drawn: the playback's virtual time while one runs (the page's
 * __tokyo.playback, else the time the view was drawn at), else now. */
function pageNow(ctx) {
  if (!ctx?.playback) return Date.now();
  try { const v = globalThis.__tokyo?.playback?.now?.(); if (Number.isFinite(v)) return v; } catch { /* the drawn time */ }
  return ctx.now ?? Date.now();
}
let boardSeq = 0;

/**
 * The station board for station `id` (MT3D station id or index) and everything in its complex: per line and direction
 * the next trains (WIB) with type, destination incl. through-running ("For Motomachi-Chukagai · via Tokyu Toyoko Line"),
 * where each is now, the last train; the first and last trains of the day. Line chips on top filter it in place;
 * complexes of 5+ lines open on a one-row-per-line summary. opts.line = show this line (id; '' = all).
 */
export function stationView(ctx, id, opts = {}) {
  const m = modelOf(ctx);
  if (!m) return '';
  const s = stationIndex(m, id);
  const st = s == null ? null : m.stations[s];
  if (!st) return '';
  boardCtx = ctx;
  const ms = ctx.now ?? Date.now();
  const lines = complexLines(m, s);
  const sel = selectedLine(m, st, lines, opts);
  const ids0 = complexOf(m, s);
  const mine = ctx.home === st.id || ids0.some((x) => m.stations[x]?.id === ctx.home);
  // saved from another station of the complex: the button names that one, so a tap clears it
  const save = `<button type="button" class="kr-save" data-act="save" data-id="${esc(mine && ctx.home ? ctx.home : st.id)}" aria-pressed="${mine}">${STAR}${esc(mine ? t('my.is') : t('my.save'))}</button>`;
  // ROUTE's planner, only when the page passes it (no hard dependency)
  const route = typeof ctx.route === 'function'
    ? `<button type="button" class="kr-save tb-route" data-tbroute="from">${esc(t('board.route.from'))}</button><button type="button" class="kr-save tb-route" data-tbroute="to">${esc(t('board.route.to'))}</button>` : '';
  const nameObj = st.name;
  const others = otherNames(m, s);
  const sub = `${others ? `${t('board.with', { names: others })} · ` : ''}${tn('n.lines', lines.length)} · ${t('sched')} · ${t('jst')}`;
  const boardId = `tb-board-${++boardSeq % 1000}`;
  return `<div class="tb-st" data-tbs="${esc(st.id)}">${placeHead({ lead: stationTile(), titleHtml: `${esc(nm(nameObj))}${altSpan(nameObj)}`, sub, close: ctx.isDesktop !== false })}
    <div class="kr-acts">${save}${route}${typeof ctx.stationActs === 'function' ? ctx.stationActs(st.id) || '' : ''}</div>
    ${lines.length >= 3 ? lineChips(m, lines, sel, boardId) : ''}
    <div class="tb-board" id="${boardId}">${boardBlock(ctx, m, s, sel, ms)}</div>
    ${note(`${calendarNote(m, ms)} <button type="button" class="kr-link" data-act="about">${esc(t('about.data'))}</button>`)}</div>`;
}

// The view's own taps (delegated once, so the page wires nothing): a line chip or summary row filters the board in
// place (only the board block is drawn again; the choice is kept per station), a route button asks ROUTE's planner.
function onBoardClick(e) {
  const el = e.target?.closest?.('.tb-st [data-tbl], .tb-st [data-tbroute]');
  if (!el) return;
  const root = el.closest('.tb-st');
  const stationId = root?.dataset.tbs;
  const ctx = boardCtx;
  if (!stationId || !ctx) return;
  if (el.dataset.tbroute) { if (typeof ctx.route === 'function') ctx.route(stationId, el.dataset.tbroute); return; }
  const m = modelOf(ctx);
  const s = m ? stationIndex(m, stationId) : null;
  if (s == null) return;
  const chip = el.classList.contains('tb-chip');
  const cur = selectedLine(m, m.stations[s], complexLines(m, s), {});
  const want = el.dataset.tbl ? lineIndex(m, el.dataset.tbl) : null;
  const next = chip && want != null && want === cur ? null : want;   // a pressed line chip again = All
  writeSel(stationId, next == null ? null : m.lines[next].id);
  const board = root.querySelector('.tb-board');
  if (board) board.innerHTML = boardBlock(ctx, m, s, next, pageNow(ctx));
  let pressed = null;
  for (const c of root.querySelectorAll('.tb-chip')) {
    const on = (c.dataset.tbl ? lineIndex(m, c.dataset.tbl) : null) === next;
    c.setAttribute('aria-pressed', String(on));
    if (on) pressed = c;
  }
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (pressed) {
    pressed.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    if (!chip) pressed.focus({ preventScroll: true });   // the tapped row is gone: keep the keyboard on the board's chip
  }
  if (!chip && board) board.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}
if (typeof document !== 'undefined' && !globalThis.__tokyoBoardClick) {
  globalThis.__tokyoBoardClick = true;
  document.addEventListener('click', onBoardClick);
}

// ------------------------------------------------------------------ first and last trains
function firstLastSection(ctx, m, s, ms, only = null, today = false) {
  const rows = firstLast(m, s, ms).filter((x) => (only == null || x.line === only) && (x.first || x.last)).map((x) => {
    const line = m.lines[x.line];
    const lastText = !x.last ? '' : x.last.loop ? t('board.last.toward', { names: names(m, x.last.toward) }) : t('board.last.to', { name: names(m, x.last.to, ja() ? '・' : ' / ') });
    const more = x.lastFor.map((f) => `${f.loop ? t('board.last.toward', { names: names(m, f.toward) }) : t('board.last.for', { name: names(m, f.to, ja() ? '・' : ' / ') })} ${clock(f.time)}`);
    const sub = [lastText, ...more].filter(Boolean).join(' · ');
    return `<div class="row tb-flr">${disc(ctx, line)}<span class="rt"><b>${esc(`${lnName(m, x.line)} · ${dirLabel(m, x.dir)}${x.split ? ` · ${t('board.at.st', { name: stName(m, x.station) })}` : ''}`)}</b><span>${esc(sub)}</span></span>
      <span class="rr tb-fl"><span><small>${esc(t('board.first'))}</small><b>${esc(x.first ? clock(x.first.time) : '–')}</b></span><span><small>${esc(t('board.lastw'))}</small><b>${esc(x.last ? clock(x.last.time) : '–')}</b></span></span></div>`;
  });
  return rows.length ? sec(t(today ? 'board.firstlast.today' : 'board.firstlast'), t('sched'), list(rows)) : '';
}
/** First and last trains of the service day from station `id`'s complex, per line and direction (a section). */
export function firstLastBlock(ctx, id) {
  const m = modelOf(ctx);
  const s = m ? stationIndex(m, id) : null;
  return s == null || !m.stations[s] ? '' : firstLastSection(ctx, m, s, ctx.now ?? Date.now());
}

// ------------------------------------------------------------------ My station (compact, on the home)
/** The rider's station on the home: per line each way the next train and the one after, then "All trains at …". */
export function myStation(ctx, id) {
  const m = modelOf(ctx);
  if (!m) return '';
  const s = stationIndex(m, id);
  const st = s == null ? null : m.stations[s];
  if (!st) return '';
  const ms = ctx.now ?? Date.now();
  liveNow = liveOf(ctx);
  const b = myStationData(m, s, ms, 2);
  const here = new Set(b.ids);
  const shown = b.byLine.slice(0, 4);
  const more = b.byLine.length - shown.length;
  const name = nm(st.name);
  const head = `<div class="kr-sth"><div><p class="eyebrow">${esc(t('my'))}</p><h2>${esc(name)}${STAR}</h2></div><button type="button" class="kr-ghost" data-act="change-home">${esc(t('my.change'))}</button></div>`;
  const rows = shown.map(({ line, groups }) => {
    const l = m.lines[line];
    const dirs = groups.map((g) => {
      const d = g.deps[0];
      if (!d) {
        // "the last train has left" only when the rest of the day is loaded (the page loads it for this card)
        const tail = g.firstNext ? `${t('board.first.next', { time: clock(g.firstNext.time) })}` : g.gone || b.known?.last ? t('board.gone') : t('board.loading');
        return `<div class="row tb-mini"><span class="rt"><b>${esc(groupLabel(m, g))}</b><span>${esc(tail)}</span></span></div>`;
      }
      const d2 = g.deps[1];
      const same = !d.loop && d.to.length === 1 && dirStation(m, g.dir) === (m.stations[d.to[0]]?.name?.en || '');
      const bits = [same ? clock(d.time) : `${clock(d.time)} ${destText(m, d)}`];
      if (d.via.length) bits.push(viaLine(m, d.via[0]));
      if (d2) bits.push(t('board.then', { time: clock(d2.time) }));
      const flag = d.last ? `<span class="tb-last">${esc(t('board.last'))}</span>` : '';
      const right = d.min < 60 ? countdown(d.min) : `<span class="cd">${esc(clock(d.time))}</span>`;
      const lb = liveBit(d);
      return `<button type="button" class="row tb-mini" data-train="${esc(d.run.key ?? d.run.id)}" aria-label="${esc(`${lnName(m, line)}, ${groupLabel(m, g)}, ${[...bits, liveText(lb)].filter(Boolean).join(', ')}`)}">
        <span class="rt"><b>${esc(groupLabel(m, g))}</b><span>${typeChip(m, d.type, g.mixed)}${esc(bits.join(' · '))}${lb ? ` · ${liveHtml(lb)}` : ''}</span></span><span class="rr">${right}${flag}</span></button>`;
    }).join('');
    const sn = noticeLine(ctx, m, line);
    return `<div class="tb-myl">${disc(ctx, l)}<span>${esc(lnName(m, line))}</span></div>${sn ? `<div class="tb-mynote">${sn}</div>` : ''}${dirs}`;
  }).join('');
  const all = `${t('my.all', { name })}${more > 0 ? ` · ${tn('board.more.lines', more)}` : ''}`;
  return `<section class="kr-home" aria-label="${esc(`${t('my')}, ${name}`)}">${head}${b.allGone ? nightCard(ctx, m, s, b) : ''}
    ${rows ? `<div class="tb-my">${rows}</div>` : `<p class="kr-none">${esc(t('station.none'))}</p>`}
    <button type="button" class="kr-more" data-station="${esc(st.id)}">${esc(all)}${icon('chev', 'chev')}</button></section>`;
}

// ------------------------------------------------------------------ home
/** Big stations offered on "Pick your station" (MT3D ids; only those in the loaded data show). */
export const HUBS = ['JR-East.Yamanote.Shinjuku', 'JR-East.Yamanote.Tokyo', 'JR-East.Yamanote.Shibuya', 'JR-East.Yamanote.Ikebukuro',
  'JR-East.Yamanote.Ueno', 'JR-East.Yamanote.Shinagawa', 'JR-East.Yamanote.Akihabara', 'TokyoMetro.Ginza.Ginza', 'TokyoMetro.Ginza.Asakusa',
  'JR-East.Yamanote.Hamamatsucho'];

function picker(ctx, m) {
  const hubs = HUBS.filter((id) => idx(m).station.has(id)).slice(0, 8);
  const art = ctx?.art?.anker;
  return `<section class="kr-pick" aria-label="${esc(t('my.pick'))}"><div class="kr-pickh">${art ? `<img src="${esc(art)}" width="72" height="72" alt="" draggable="false" decoding="async">` : ''}
    <div><b>${esc(t('my.pick'))}</b><span>${esc(t('my.pick.sub'))}</span></div></div>
    <button type="button" class="btn" data-act="locate">${icon('locate')}${esc(ctx?.nearby ? t('nb.go') : t('locate'))}</button>
    <div class="kr-hubs">${hubs.map((id) => `<button type="button" class="chip" data-home="${esc(id)}">${esc(stName(m, idx(m).station.get(id)))}</button>`).join('')}</div></section>`;
}

// ------------------------------------------------------------------ operator chips
// All · JR · Metro · Toei · Private with the trains running now under the headline. On the Lines tab they filter the
// operator sections in place (kept for this tab: sessionStorage, memory when storage is blocked; the pressed chip again
// = All); on the home a tap opens the Lines tab with that filter: the chip carries the page's own data-tab, and a
// capture listener writes the filter before the page draws the tab.
const OPG_KEY = 'tokyo.lines.op';
const OPGS = [...CHIPS, 'tj'];   // 'tj' = TransJakarta: buses simulated from the timetable (its own chip, never in the train total)
let opgMem = null;
function readOpg() {
  try { const v = sessionStorage.getItem(OPG_KEY); return OPGS.includes(v) ? v : null; } catch { return opgMem; }
}
function writeOpg(k) {
  opgMem = OPGS.includes(k) ? k : null;
  try { if (opgMem) sessionStorage.setItem(OPG_KEY, opgMem); else sessionStorage.removeItem(OPG_KEY); } catch { /* memory only */ }
}
function opChips(r, where, ctx = null) {
  const sel = where === 'lines' ? readOpg() : null;
  const keys = where === 'lines' ? CHIPS.filter((k) => k !== 'other' || r.by[k]) : CHIPS.filter((k) => r.by[k]);
  const c = (k, label, n) => `<button type="button" class="chip" data-opgrp="${k}"${where === 'home' ? ' data-tab="lines"' : ` aria-pressed="${(sel || 'all') === k}"`}>${esc(label)} <b>${esc(fmtNum(n || 0))}</b></button>`;
  return `<div class="chips kr-chips tb-opchips" role="group" aria-label="${esc(t('board.chips'))}">${where === 'home' ? liveChip(ctx) : ''}${c('all', t('board.lines.all'), r.total)}${keys.map((k) => c(k, t(`board.chip.${k}`), r.by[k])).join('')}${ctx?.tj ? (ctx.tj.n == null ? c('tj', 'TransJakarta', 0).replace(' <b>0</b>', '') : c('tj', 'TransJakarta', ctx.tj.n)) : ''}</div>`;
}

// ------------------------------------------------------------------ the live trains, said plainly
// ctx.liveN = trains with a FRESH live position now (live.js: the runs measured <= 150 s ago, the count the Live now sheet
// adds up: coverage.js coverageOf().counts.liveTrains); ctx.liveOnly = the Live chip is pressed (the map shows only those
// trains). No live train, live off or a playback: today's wording and no Live chip (never call a
// timetable position live). The green dot is the Live pill's.
const LDOT = '<i class="tk-ldot" aria-hidden="true"></i>';
/** Trains with a fresh live position now per ctx (0 in a playback or without live data). */
export const liveCountOf = (ctx) => (ctx?.playback ? 0 : Math.max(0, Math.floor(Number(ctx?.liveN) || 0)));
/** The Live chip, first in the home's operator chips: pressed = the map shows only the live trains; pressed again = all. */
function liveChip(ctx) {
  const n = liveCountOf(ctx);
  if (!n) return '';
  return `<button type="button" class="chip tk-livechip" data-act="live-only" aria-pressed="${!!ctx.liveOnly}">${LDOT}${esc(t('lvis.chip'))} <b>${esc(fmtNum(n))}</b></button>`;
}
/** The headline's live part, a button to the Live now sheet (#live: the page's data-act="sched"): "● 281 live" over "the
 * rest scheduled" (the other trains are still timetable positions: rule 6 keeps saying so), or with the Live chip pressed
 * "● with a live position" after the live count (the map then shows only those). */
function liveHead(n, only) {
  const text = only ? t('lvis.only') : t('lvis.head', { n: fmtNum(n) });
  const aria = only ? t('lvis.only.aria', { n: fmtNum(n) }) : t('lvis.head.aria', { n: fmtNum(n) });
  const rest = only ? '' : `<span class="tk-lh2">${esc(t('lvis.rest'))}</span>`;
  return `<button type="button" class="tk-livehead" data-act="sched" aria-label="${esc(aria)}"><span class="tk-lh1">${LDOT}<span>${esc(text)}</span></span>${rest}</button>`;
}
function onOpChip(e) {
  const el = e.target?.closest?.('.tb-opchips [data-opgrp]');
  if (!el) return;
  const k = el.dataset.opgrp === 'all' ? null : el.dataset.opgrp;
  if (el.dataset.tab) { writeOpg(k); return; }   // home: the page opens the Lines tab, drawn with this filter
  const next = k && k !== readOpg() ? k : null;
  writeOpg(next);
  const scope = el.closest('.tb-opchips')?.parentElement || document;
  for (const s of scope.querySelectorAll('section.sec[data-opgrp]')) s.hidden = !!next && s.dataset.opgrp !== next;
  for (const c of el.parentElement.querySelectorAll('[data-opgrp]')) c.setAttribute('aria-pressed', String((next || 'all') === c.dataset.opgrp));
}
if (typeof document !== 'undefined' && !globalThis.__tokyoOpChips) {
  globalThis.__tokyoOpChips = true;
  document.addEventListener('click', onOpChip, true);
}

/** "Now · 12:00 WIB / 1,234 trains running by the timetable" (+ the operator chips), or when the first train leaves
 * when none runs. In a playback the eyebrow says so ("Playback · 08:00 WIB": playback.js's pb.eyebrow). */
function nowBlock(ctx, m, ms, r, where = 'home') {
  const eb = `<p class="eyebrow">${esc(t(ctx?.playback ? 'pb.eyebrow' : 'now.eyebrow', { time: clock(serviceTime(ms).seconds) }))}</p>`;
  if (r.total) {
    // "1,308 trains (● 281 live)"; Live chip pressed (home): "281 trains (● with a live position)"
    const live = liveCountOf(ctx), only = !!(live && ctx?.liveOnly && where === 'home');
    const head = live
      ? `<span class="display">${esc(tn('n.trains', only ? live : r.total))}</span>${liveHead(live, only)}`
      : `<span class="display">${esc(tn('n.trains', r.total))}</span><span class="callout c2">${esc(t('now.running'))}</span>`;
    return `<div class="kr-now">${eb}<div class="big">${head}</div></div>${opChips(r, where, ctx)}`;
  }
  const f = nextFirst(m, ms);
  return `<div class="kr-now">${eb}<div class="big"><span class="title">${esc(ctx?.playback ? t('pb.none', { time: clock(serviceTime(ms).seconds) }) : t('none.running'))}</span></div>${f ? `<p class="caption c2">${esc(t('first.train', { time: clock(f.time), station: stName(m, f.run.stops[0].s) }))}</p>` : ''}</div>${where === 'lines' ? opChips(r, where, ctx) : ''}`;
}

/** An operator's round tile: its short mark (JR, M, 都, …) on a light disc; JR Central = JR in its orange ring (its old
 * 'JC' read like the Chuo Rapid line's code). */
const OP_MARK = { 'JR-East': 'JR', 'JR-Central': 'JR', TokyoMetro: 'M', Toei: '都', Tobu: 'TB', Tokyu: 'TY', Seibu: 'SI', Odakyu: 'OH', Keio: 'KO',
  Keikyu: 'KK', Keisei: 'KS', Sotetsu: 'SO', YokohamaMunicipal: 'YS', Minatomirai: 'MM', MIR: 'TX', TWR: 'R', Hokuso: 'HS', Yurikamome: 'U',
  TokyoMonorail: 'MO', SaitamaRailway: 'SR', ToyoRapid: 'TR' };
const initials = (s) => String(s || '').split(/[\s\-()]+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const opTile = (opId, opTitle) => {
  const mk = OP_MARK[opId] || initials(opTitle?.en || opId) || '·';
  // a kanji mark (都) is Japanese text inside an EN / ID page: lang so a screen reader / the fonts read it as Japanese
  return `<span class="tb-opt" data-op="${esc(opId)}" aria-hidden="true"${/[^\x00-\x7F]/.test(mk) ? ' lang="ja"' : ''}>${esc(mk)}</span>`;
};

/**
 * The home: trains running now (by the timetable) and per operator, My station (or the picker), the note.
 */
export function homeView(ctx) {
  const m = modelOf(ctx);
  if (!m) return '';
  const ms = ctx.now ?? Date.now();
  const r = runningByOperator(m, ms);
  const home = ctx.home != null && stationIndex(m, ctx.home) != null ? myStation(ctx, ctx.home) : picker(ctx, m);
  const rows = r.ops.map((o) => {
    const top = o.lines.slice(0, 2).map((x) => `${lnName(m, x.line)} ${fmtNum(x.n)}`).join(' · ');
    const opn = opText({ id: o.op, title: o.title });
    return `<button type="button" class="row" data-tab="lines" aria-label="${esc(`${opn}, ${tn('n.trains', o.n)}`)}">${opTile(o.op, o.title)}<span class="rt"><b>${esc(opn)}</b><span>${esc(`${tn('n.lines', o.lines.length)} · ${top}`)}</span></span><span class="rr"><span class="big">${esc(fmtNum(o.n))}</span><small>${esc(t('board.trains.word'))}</small></span></button>`;
  });
  // TransJakarta: buses simulated from the GTFS timetable (web/src/tokyo/buses/). Its own row and its own count, never
  // added to the trains; only when the bus pack was built (ctx.tj). A tap switches the bus layer on and shows the map.
  if (ctx.tj) {
    const n = ctx.tj.on && Number.isFinite(ctx.tj.n) ? ctx.tj.n : null, sub = t(ctx.tj.on ? 'bus.row.sub' : 'bus.row.off');
    rows.unshift(`<button type="button" class="row" data-act="buses-map" aria-label="${esc(`TransJakarta, ${n != null ? `${fmtNum(n)} ${t('bus.word')}, ` : ''}${sub}`)}">${opTile('TransJakarta', { en: 'TransJakarta' })}<span class="rt"><b>TransJakarta</b><span>${esc(sub)}</span></span>${n != null ? `<span class="rr"><span class="big">${esc(fmtNum(n))}</span><small>${esc(t('bus.word'))}</small></span>` : ''}</button>`);
  }
  return `${nowBlock(ctx, m, ms, r, 'home')}
    ${serviceBlock(ctx, m)}
    ${rows.length ? sec(ctx.playback ? t('pb.ops', { time: clock(serviceTime(ms).seconds) }) : t('board.ops'), t('sched'), list(rows)) : ''}
    ${home}
    ${busesBlock(ctx)}
    ${note(`${calendarNote(m, ms)} <button type="button" class="kr-link" data-act="about">${esc(t('about.data'))}</button>`)}`;
}

// ------------------------------------------------------------------ buses near the map centre
// The bus layer draws on the WebGL canvas, so a keyboard or screen-reader user cannot reach a bus there. While buses
// are on, the home lists the six nearest the map centre as buttons (route tag, "For <headsign>", next stop, live words,
// distance; the bus layer's rowsHtml) that open the bus sheet, as a tap on the map does. Refreshed with the home (15 s).
const busesOf = (ctx) => ctx?.buses ?? (typeof globalThis !== 'undefined' ? globalThis.__tokyo?.buses : null) ?? null;
let busOpen = null;
function busesBlock(ctx) {
  const bz = busesOf(ctx);
  if (!bz?.on || typeof bz.near !== 'function' || typeof bz.rowsHtml !== 'function') return '';
  let c = null;
  try { c = ctx.map?.getCenter?.(); } catch { c = null; }
  if (!c || !Number.isFinite(c.lng) || !Number.isFinite(c.lat)) return '';
  let rows = '';
  try { rows = bz.rowsHtml(bz.near([c.lng, c.lat], 6), { t, lang: lang() }); } catch (e) { console.warn('[tokyo] bus list', e); rows = ''; }
  if (!rows) return '';
  if (typeof ctx.open === 'function') busOpen = ctx.open;
  return sec(t('bus.list'), t('bus.list.sub'), `<div class="list">${rows}</div>`);
}
/** A click on a bus row (button[data-bus]) opens that bus (the page's open: #b=<id>, history, focus back on Back). */
export function onBusClick(e) {
  const b = e.target?.closest?.('button[data-bus]');
  if (!b?.dataset?.bus) return;
  const open = busOpen || (typeof globalThis !== 'undefined' ? globalThis.__tokyo?.open : null);
  if (typeof open !== 'function') return;
  e.preventDefault?.();
  open('bus', b.dataset.bus);
}
if (typeof document !== 'undefined' && !globalThis.__tokyoBusClick) {
  globalThis.__tokyoBusClick = true;
  document.addEventListener('click', onBusClick);
}

// ------------------------------------------------------------------ Lines tab, line rhythm
/** "every ~4 min" / "1 train in the next hour" / "next 05:01" / "The last train has left" / "no trains in the timetable".
 * running = trains on the line now: with nothing more leaving, a running last train never reads "no trains". */
function rhythmText(rh, ms, m = null, running = 0) {
  const best = rh.dirs.filter((d) => d.gap).sort((a, b) => a.gap - b.gap)[0];
  if (best) return t('board.every', { n: fmtNum(best.gap) });
  if (rh.dirs.some((d) => d.perHour === 1)) return t('board.hour.one');
  const nx = rh.dirs.map((d) => d.next).filter(Boolean).sort((a, b) => a.at - b.at)[0];
  if (nx) return t('board.next.at', { time: clock(nx.time) });
  if (running > 0 || rh.dirs.length) return m && !coverage(m).last ? t('board.loading') : t('board.gone');
  return t('board.notrains');
}
/** search.js's line families (search.js fams): MT3D titles branches exactly like their main line ("Musashino Line" x6,
 *  same operator, name and colour): the Lines tab shows them as one row. */
const famFold = (s) => String(s ?? '').normalize('NFKC').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
function lineFamilies(m, lines) {
  const by = new Map(), out = [];
  for (const i of lines) {
    const l = m.lines[i];
    const k = `${String(l.id || '').split('.')[0]}|${famFold(l.title?.en || l.id)}|${l.color || ''}`;
    if (!by.has(k)) { by.set(k, out.length); out.push([]); }
    out[by.get(k)].push(i);
  }
  return out.map((members) => ({ members, main: members.reduce((a, b) => ((m.lines[b].stations?.length || 0) > (m.lines[a].stations?.length || 0) ? b : a), members[0]) }));
}

/** The Lines tab: every line by operator, how many trains run on it now and how often they come. */
export function linesView(ctx) {
  const m = modelOf(ctx);
  if (!m) return '';
  const ms = ctx.now ?? Date.now();
  const r = runningByOperator(m, ms);
  const byOp = new Map();
  m.lines.forEach((l, i) => { const op = operatorOf(m, i); if (!byOp.has(op.id)) byOp.set(op.id, { op, lines: [] }); byOp.get(op.id).lines.push(i); });
  const count = (id) => r.ops.find((o) => o.op === id)?.n || 0;
  const opg = readOpg();
  const opOrder = [...byOp.values()].sort((a, b) => (OP_RANK_ORDER(a.op.id) - OP_RANK_ORDER(b.op.id)) || count(b.op.id) - count(a.op.id) || a.op.id.localeCompare(b.op.id));
  const secs = opOrder.map(({ op, lines }) => {
    const fams = lineFamilies(m, lines);
    const rows = fams.map(({ members, main: i }) => {
      const l = m.lines[i];
      const n = members.reduce((a, x) => a + (r.byLine.get(x) || 0), 0);
      const rh = { dirs: members.flatMap((x) => lineRhythm(m, x, ms).dirs) };   // the best of the family's rhythms
      const stations = new Set(members.flatMap((x) => m.lines[x].stations || [])).size;
      const sev = members.map((x) => sevBit(ctx, m, x)).find(Boolean) || '';
      const susp = members.every((x) => suspendedOf(m, x)) ? suspendedOf(m, i) : null;   // suspended: the words, no count
      if (susp) return `<button type="button" class="row" data-line="${esc(l.id)}" aria-label="${esc(`${lnName(m, i)}, ${suspWords(susp)}`)}">${disc(ctx, l)}<span class="rt"><b>${esc(lnName(m, i))}${altSpan(l.title)}</b><span><span class="tb-sevbit" data-sev="suspended">${sevIcon('suspended')}${esc(suspWords(susp))}</span> · ${esc(tn('n.stations', stations))}</span></span>${icon('chev', 'chev')}</button>`;
      return `<button type="button" class="row" data-line="${esc(l.id)}" aria-label="${esc(`${lnName(m, i)}, ${tn('n.running', n)}`)}">${disc(ctx, l)}<span class="rt"><b>${esc(lnName(m, i))}${altSpan(l.title)}</b><span>${sev}${esc(`${rhythmText(rh, ms, m, n)} · ${tn('n.stations', stations)}`)}</span></span><span class="rr"><span class="big">${esc(fmtNum(n))}</span><small>${esc(t('board.trains.word'))}</small></span>${icon('chev', 'chev')}</button>`;
    });
    const k = chipOf(op.id);
    return sec(opText(op), tn('n.lines', fams.length), list(rows)).replace('<section class="sec"', `<section class="sec" data-opgrp="${k}"${opg && opg !== k ? ' hidden' : ''}`);
  }).join('');
  // TransJakarta: the bus routes (buses/browse.js, once the bus pack is in), else a row that switches the bus layer on
  let tj = '';
  if (ctx.tj) {
    try { tj = busesOf(ctx)?.linesHtml?.({ t, lang: lang(), now: ms, hidden: !!opg && opg !== 'tj' }) || ''; } catch (e) { console.warn('[tokyo] bus routes', e); }
    if (!tj) tj = sec('TransJakarta', t('bus.list.sub'), list([`<button type="button" class="row" data-act="buses-map">${opTile('TransJakarta', { en: 'TransJakarta' })}<span class="rt"><b>TransJakarta</b><span>${esc(t('bus.row.off'))}</span></span></button>`])).replace('<section class="sec"', `<section class="sec" data-opgrp="tj"${opg && opg !== 'tj' ? ' hidden' : ''}`);
  }
  return `${nowBlock(ctx, m, ms, r, 'lines')}${secs}${tj}${note(`${esc(t('board.rhythm.note'))} ${esc(t('sched.long'))}`)}`;
}
/** "⚠ Delays · " before a Lines-tab row's rhythm when the line has a notice (icon + word). */
function sevBit(ctx, m, l) {
  const st = statusOf(ctx, m, l);
  if (!st || st.severity === 'normal') return '';
  const sev = sevOf(st);
  return `<span class="tb-sevbit" data-sev="${sev}">${sevIcon(sev)}${esc(t(`live.sev.${sev}`))}</span> · `;
}
const OP_RANK_ORDER = (id) => ({ 'JR-East': 0, 'JR-Central': 1, TokyoMetro: 2, Toei: 3 })[id] ?? 4;

/** A line's rhythm now, per direction: how many trains run that way and the gap between them (a section for the line
 * view). lineId = MT3D line id or index. */
export function rhythmBlock(ctx, lineId) {
  const m = modelOf(ctx);
  if (!m) return '';
  const l = lineIndex(m, lineId);
  if (l == null || !m.lines[l]) return '';
  const ms = ctx.now ?? Date.now();
  const rh = lineRhythm(m, l, ms);
  const rows = rh.dirs.map((d) => {
    const head = dirLabel(m, d.dir);
    const gap = d.gap ? t('board.every', { n: fmtNum(d.gap) }) : d.perHour === 1 ? t('board.hour.one') : d.next ? t('board.next.at', { time: clock(d.next.time) }) : t('board.notrains');
    const at = d.ref != null ? t('board.read.at', { name: stName(m, d.ref) }) : '';
    return `<div class="row"><span class="rt"><b>${esc(head)}</b><span>${esc([gap, at].filter(Boolean).join(' · '))}</span></span><span class="rr"><span class="big">${esc(fmtNum(d.running))}</span><small>${esc(t('board.trains.word'))}</small></span></div>`;
  });
  return rows.length ? sec(t('board.rhythm'), `${tn('n.running', rh.total)} · ${t('sched')}`, `${noticeLine(ctx, m, l)}${list(rows)}`) : '';
}

