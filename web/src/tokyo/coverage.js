// the "Live now" sheet. Which lines show live positions right now,
// which only carry estimated delays and which run on the timetable only, so a Scheduled Yamanote train never looks like
// a bug and a Live ring is never a surprise (never present timetable positions as live). Opened from
// the Live/Scheduled pill (page.js, route #live). Per operator it shows the data time ("as of 19:42", WIB); the
// sources are credited in About, as their licences ask.
//
// The verdict per run is live.js's own (web/src/tokyo/live.js: stateOf / estimateOf / liveOf / updatedAt, its 150 s
// freshness and 20 min estimate rules); nothing here re-implements matching or freshness. A line is
//   'live'       >= 1 of its runs is live.stateOf(run) === 'live' (a fresh measured position)
//   'estimated'  none live, >= 1 run 'estimated' (a delay carried from an earlier report: through service, a stale report)
//                that is on the line now (LIVE also carries delays to next runs that have not begun: those are not counted)
//   'timetable'  everything else
//
//   import { coverageOf, coverageHtml, mountCoverage, asOf } from './coverage.js';
//   coverageOf(model, live, nowMs) -> {
//     state: 'none' (no live layer: playback, not loaded) | live.state().state ('idle'|'off'|'on'|'error'), at: nowMs,
//     total (lines), lines: [row] (model order),
//     row = { line (index), id, op (operator id), state: 'live'|'estimated'|'timetable', live (runs live now),
//             est (runs on the line now with an estimated delay), running (runs on the line now, as the map draws them), at (ms | null: the operator's
//             data time for a live line = live.json `ops`, the newest last report for an estimated line),
//             from (line index the estimate was carried from when that is another line, else null) },
//     groups: { live: [{ op, at, lines: [row] }], estimated: [{ op, at, lines }], timetable: [{ op, at: null, lines }] },
//     counts: { live, estimated, timetable (lines), liveTrains, estTrains } }
//   coverageHtml(model, cov, { desktop, playback, open }) -> the sheet's HTML (open = the Timetable only lines shown)
//   asOf(ms) -> "as of 19:42" | "19:42時点" | "per 19.42" (WIB, the page language)
//   mountCoverage(el, ctx) -> { el, update(), destroy() }
//     ctx = { model: () => model.js model | null, live: () => live layer | null, now: () => ms, isDesktop?: () => bool,
//             playback?: () => bool }   (plain values work too)
//     Draws into el (a host the page never re-renders) and redraws on live changes, every 15 s and on a language switch,
//     keeping keyboard focus on the same control. Rows are buttons with data-line (the page opens the line view), the X
//     (desktop) is data-act="back", "About the data" is data-act="about"; the Timetable only toggle is the sheet's own.
//
// Look: kereta's place head (.ph), sections (.sec / .sech h2), inset lists (.list / .row), types.js's lineChip() ring
// in the line's exact colour (never tinted), operator captions as h3, 44 px+ targets, lang on the other script's names.

import { esc } from '../app/format.js';
import { icon } from '../app/ui.js';
import { clockMs, fmtNum, lang, onLang, t, title, titleAlt, tn } from './i18n.js';
import { lineChip, opName } from './types.js';
import { operatorOf, opRank, runningByOperator, runningOn } from './board.js';

export const REFRESH_MS = 15000;

// ------------------------------------------------------------------ the data
/** The runs LIVE knows about now: measured + estimated (live.delays keys) and the measured set. */
function knownRuns(live) {
  const out = new Set();
  try { for (const r of live?.delays?.keys?.() || []) out.add(r); } catch { /* none */ }
  try { for (const r of live?.measured || []) out.add(r); } catch { /* none */ }
  return out;
}
const num = (v) => (Number.isFinite(v) ? v : null);
const newest = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));
function call(fn, ...args) { try { return fn(...args); } catch { return null; } }

/**
 * Coverage per line now. model = model.js's model (createModel); live = live.js's layer (or a stand-in with the same
 * methods), null = no live layer (everything timetable); nowMs = the page clock (running counts).
 */
export function coverageOf(model, live, nowMs = Date.now()) {
  const lines = model?.lines || [];
  const hasLive = !!live && typeof live.stateOf === 'function';
  let state = 'none';
  if (hasLive) state = call(() => live.state?.().state) || 'on';
  const lineIx = new Map(lines.map((L, i) => [L.id, i]));
  const rows = lines.map((L, i) => ({ line: i, id: L.id, op: operatorOf(model, i).id, state: 'timetable', live: 0, est: 0,
    running: 0, at: null, from: null }));
  let running = null;
  try { running = runningByOperator(model, nowMs).byLine; } catch { running = null; }
  if (running) for (const [l, n] of running) if (rows[l]) rows[l].running = n;

  if (hasLive) {
    const liveAt = new Map(), estAt = new Map(), srcs = new Map();   // line -> newest report / estimate time, source lines
    const ests = new Map(), lives = new Map();                       // line -> its estimated / live runs
    for (const run of knownRuns(live)) {
      const row = rows[run?.line];
      if (!row) continue;
      const st = call(() => live.stateOf(run));
      if (st === 'live') {
        row.live += 1;
        if (!lives.has(row.line)) lives.set(row.line, []);
        lives.get(row.line).push(run);
        liveAt.set(row.line, newest(liveAt.get(row.line) ?? null, num(call(() => live.liveOf?.(run)?.at))));
      } else if (st === 'estimated') {
        if (!ests.has(row.line)) ests.set(row.line, []);
        ests.get(row.line).push(run);
      }
    }
    const onLine = (l) => { try { return new Set(runningOn(model, l, nowMs).map((p) => p.run || p)); } catch { return null; } };
    // a reported train not drawn yet (waiting at its origin before departure) still counts as running on its line
    for (const [l, list] of lives) {
      const on = onLine(l);
      if (on) rows[l].running += list.filter((run) => !on.has(run)).length;
    }
    // estimated = on the line NOW (as the map draws it): LIVE also carries a delay to next runs that have not begun yet
    for (const [l, list] of ests) {
      const on = onLine(l);
      for (const run of list) {
        if (on && !on.has(run)) continue;
        const row = rows[l];
        row.est += 1;
        const e = call(() => live.estimateOf?.(run));
        estAt.set(l, newest(estAt.get(l) ?? null, num(e?.source?.at)));
        const from = lineIx.get(e?.source?.line);
        if (from != null) {
          if (!srcs.has(l)) srcs.set(l, new Map());
          srcs.get(l).set(from, (srcs.get(l).get(from) || 0) + 1);
        }
      }
    }
    for (const row of rows) {
      if (row.live) {
        row.state = 'live';
        // the guideline's data time: the operator's newest data (live.json `ops`), else the newest report on the line
        row.at = num(call(() => live.updatedAt?.(row.id))) ?? liveAt.get(row.line) ?? null;
      } else if (row.est) {
        row.state = 'estimated';
        row.at = estAt.get(row.line) ?? null;
        const s = srcs.get(row.line);
        if (s) {
          const top = [...s.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
          row.from = top === row.line ? null : top;
        }
      }
      row.running = Math.max(row.running, row.live);
    }
  }

  const group = (state, order) => {
    const by = new Map();
    for (const r of rows) {
      if (r.state !== state) continue;
      if (!by.has(r.op)) by.set(r.op, { op: r.op, at: null, lines: [] });
      const g = by.get(r.op);
      g.lines.push(r);
      if (state !== 'timetable') g.at = newest(g.at, r.at);
    }
    return [...by.values()].sort(order);
  };
  const trains = (g) => g.lines.reduce((n, r) => n + r.live + r.est, 0);
  const rank = (a, b) => opRank(a.op) - opRank(b.op);
  const groups = {
    live: group('live', (a, b) => rank(a, b) || trains(b) - trains(a) || a.op.localeCompare(b.op)),
    estimated: group('estimated', (a, b) => rank(a, b) || trains(b) - trains(a) || a.op.localeCompare(b.op)),
    timetable: group('timetable', (a, b) => rank(a, b) || b.lines.length - a.lines.length || a.op.localeCompare(b.op)),
  };
  const count = (s) => rows.filter((r) => r.state === s).length;
  return {
    state, at: nowMs, total: rows.length, lines: rows, groups,
    counts: { live: count('live'), estimated: count('estimated'), timetable: count('timetable'),
      liveTrains: rows.reduce((n, r) => n + r.live, 0), estTrains: rows.reduce((n, r) => n + r.est, 0) },
  };
}

/** "as of 19:42" / "19:42時点" / "per 19.42": a data time (epoch ms) as the WIB clock in the page language. */
export const asOf = (ms) => (Number.isFinite(ms) ? t('cov.asof', { time: clockMs(ms) }) : '');

// ------------------------------------------------------------------ the sheet
export const COVERAGE_CSS = `
.cov{display:grid;gap:18px;min-width:0}
.cov-tile{background:var(--panel);color:var(--text2)}
.cov-tile svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.cov-tile .cov-dot{fill:var(--text3);stroke:none}
.cov-tile[data-on] .cov-dot{fill:var(--income)}
.cov-op{margin:4px 0 0;padding:0 4px;font:600 13px/18px var(--font);color:var(--text2);min-width:0}
.cov-op small{font:400 13px/18px var(--font);color:var(--text2);font-variant-numeric:tabular-nums}
.cov .row.cov-row{min-height:52px;padding-top:6px;padding-bottom:6px}
.cov .row.cov-row.cov-tt{min-height:44px}
.cov .row.cov-row + .row.cov-row::before{left:54px}
.cov .row.cov-row.nw .rt b,.cov .row.cov-row.nw .rt > span{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cov .cov-row .rr small{display:inline-flex;align-items:center;gap:5px;color:var(--text2)}
.cov-ldot{flex:none;display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--income)}
.cov-note{margin:0;padding:12px 14px;border-radius:18px;background:var(--panel);font:400 14px/19px var(--font);color:var(--text)}
.cov-more{justify-self:start;height:44px;padding:0 16px;font:500 15px/20px var(--font)}
.cov-more svg.i{width:16px;height:16px;transform:rotate(90deg);transition:transform .2s}
.cov-more[aria-expanded="true"] svg.i{transform:rotate(-90deg)}
.cov-ttb{display:grid;gap:8px;min-width:0}
.cov-ttb[hidden]{display:none}
.cov-key{display:grid;gap:8px;margin:0;padding:12px 14px;border-radius:18px;background:var(--panel);font:400 13px/18px var(--font);color:var(--text2)}
.cov-key p{margin:0}
.cov-key b{font-weight:600;color:var(--text)}
.cov-key .cov-ldot{margin-right:6px;vertical-align:1px}
.cov-about{display:inline-flex;align-items:center;justify-self:start;min-height:44px;padding:0 2px;background:none;font:600 14px/18px var(--font);color:var(--text2);text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px}
@media (prefers-reduced-motion: reduce){.cov-more svg.i{transition:none}}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head) return;
  cssDone = true;
  if (document.getElementById('tk-cov-css')) return;
  const el = document.createElement('style');
  el.id = 'tk-cov-css';
  el.textContent = COVERAGE_CSS;
  document.head.append(el);
}

const ja = () => lang() === 'ja';
const altLang = () => (ja() ? 'en' : 'ja');
/** An operator's short name: 'Toei', 'JR East', '都営', '東京メトロ' (views.js opText). */
const opText = (id) => (ja() && id === 'TokyoMetro' ? '東京メトロ' : opName(id, lang(), true) || id);
const lineTitle = (m, l) => title(m.lines[l]?.title);
// the head's tile: a "live" mark (a dot with two arcs), the dot green only while some line is live (colour = data)
const SIG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="cov-dot" cx="12" cy="12" r="2.6"/><path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13"/></svg>';

function head(sub, on, desktop) {
  const x = desktop ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(t('close'))}">${icon('x')}</button>` : '';
  return `<div class="ph" data-drag><span class="etile cov-tile"${on ? ' data-on' : ''} aria-hidden="true">${SIG}</span><div class="rt"><h2>${esc(t('cov.title'))}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${x}</div>`;
}

/** One line as a kereta row: ring chip, name (+ the other script's name), what is known about it, live count. */
function lineRow(m, r, kind) {
  const L = m.lines[r.line];
  const name = lineTitle(m, r.line), alt = titleAlt(L.title);
  const altHtml = alt ? `<span class="tk-alt" lang="${altLang()}">${esc(alt)}</span>` : '';
  const chip = lineChip(L, lang(), { size: 'sm' });
  let sub = [], right = '', said = [name];
  if (kind === 'live') {
    sub = [t('cov.running', { n: fmtNum(r.running) }), r.est ? t('cov.est.n', { n: fmtNum(r.est) }) : ''].filter(Boolean);
    right = `<span class="rr"><span class="big">${esc(fmtNum(r.live))}</span><small><i class="cov-ldot" aria-hidden="true"></i>${esc(t('cov.w.live'))}</small></span>`;
    said.push(`${fmtNum(r.live)} ${t('cov.w.live')}`);
  } else if (kind === 'estimated') {
    const time = Number.isFinite(r.at) ? clockMs(r.at) : '';
    if (r.from != null && time) sub = [t('cov.from', { line: lineTitle(m, r.from), time })];
    else if (r.from != null) sub = [t('cov.from.only', { line: lineTitle(m, r.from) })];
    else if (time) sub = [t('cov.last', { time })];
    right = `<span class="rr"><span class="big">${esc(fmtNum(r.est))}</span><small>${esc(t('cov.w.est'))}</small></span>`;
    said.push(`${fmtNum(r.est)} ${t('cov.w.est')}`);
  }
  said = said.concat(sub);
  const cls = kind === 'timetable' ? 'row cov-row cov-tt' : 'row cov-row nw';   // live / estimated rows wrap to 2 lines (long names, report times)
  return `<button type="button" class="${cls}" data-line="${esc(L.id)}" aria-label="${esc(said.join(', '))}">${chip}<span class="rt"><b>${esc(name)}${altHtml}</b>${sub.length ? `<span>${esc(sub.join(' · '))}</span>` : ''}</span>${right}${icon('chev', 'chev')}</button>`;
}

/** An operator's caption (h3) and its lines in one inset list. */
function opBlock(m, g, kind) {
  const small = kind === 'live' && Number.isFinite(g.at) ? asOf(g.at)
    : kind === 'timetable' ? tn('cov.n.lines', g.lines.length) : '';
  return `<h3 class="cov-op"><span>${esc(opText(g.op))}</span>${small ? `<small> · ${esc(small)}</small>` : ''}</h3><div class="list cov-list">${g.lines.map((r) => lineRow(m, r, kind)).join('')}</div>`;
}

const section = (id, h, small, body) => `<section class="sec cov-g" data-g="${id}" aria-labelledby="cov-h-${id}"><div class="sech"><h2 id="cov-h-${id}">${esc(h)}</h2>${small ? `<small>${esc(small)}</small>` : ''}</div>${body}</section>`;

/** The key: what Live position / Estimated / Scheduled mean (the words the pill and the trains use). */
const keyHtml = () => `<div class="cov-key"><p><b><i class="cov-ldot" aria-hidden="true"></i>${esc(t('tv.live'))}</b> · ${esc(t('cov.k.live'))}</p><p><b>${esc(t('pill.est'))}</b> · ${esc(t('cov.k.est'))}</p><p><b>${esc(t('sched'))}</b> · ${esc(t('cov.k.tt'))}</p></div>`;
const aboutLink = () => `<button type="button" class="cov-about" data-act="about">${esc(t('about.data'))}</button>`;

/** The sheet for a coverageOf() result. opts: { desktop, playback, open (Timetable only lines shown) }. */
export function coverageHtml(m, cov, { desktop = false, playback = false, open = false } = {}) {
  ensureCss();
  if (!m || !cov) return `<div class="cov">${head('', false, desktop)}<div class="empty card"><b>${esc(t('data.loading'))}</b></div></div>`;
  const { groups, counts } = cov;
  if (playback) {
    return `<div class="cov">${head(t('cov.sub.none'), false, desktop)}<p class="cov-note">${esc(t('cov.pb'))}</p>${keyHtml()}${aboutLink()}</div>`;
  }
  const sub = counts.live ? t('cov.sub', { n: fmtNum(counts.live), total: fmtNum(cov.total) }) : t('cov.sub.none');
  const out = [head(sub, counts.live > 0, desktop)];
  if (!counts.live && !counts.estimated) out.push(`<p class="cov-note">${esc(t('cov.none'))}</p>`);   // estimates are not the timetable
  if (counts.live) {
    out.push(section('live', t('cov.g.live'), tn('cov.n.lines', counts.live), groups.live.map((g) => opBlock(m, g, 'live')).join('')));
  }
  if (counts.estimated) {
    out.push(section('estimated', t('cov.g.est'), tn('cov.n.lines', counts.estimated), groups.estimated.map((g) => opBlock(m, g, 'estimated')).join('')));
  }
  if (counts.timetable) {
    const btn = `<button type="button" class="btn cov-more" data-cov="more" aria-expanded="${open}" aria-controls="cov-ttb">${esc(open ? t('cov.hide') : t('cov.show', { n: fmtNum(counts.timetable) }))}${icon('chev')}</button>`;
    const body = `<div class="cov-ttb" id="cov-ttb"${open ? '' : ' hidden'}>${open ? groups.timetable.map((g) => opBlock(m, g, 'timetable')).join('') : ''}</div>`;
    out.push(section('timetable', t('cov.g.tt'), tn('cov.n.lines', counts.timetable), btn + body));
  }
  out.push(keyHtml(), aboutLink());
  return `<div class="cov">${out.join('')}</div>`;
}

// ------------------------------------------------------------------ the mount
const FOCUS_KEYS = ['cov', 'line', 'act'];
/** The focused control's data-* signature, to find it again after a redraw. */
function sigOf(el) {
  if (!el || !el.dataset) return '';
  if (el.matches?.('.ph h2')) return '.ph h2';
  for (const k of FOCUS_KEYS) {
    const v = el.dataset[k];
    if (v != null) return `[data-${k}="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&')}"]`;
  }
  return '';
}

/**
 * Mount the sheet in el. ctx values may be functions (read on every draw) or plain values. Returns { el, update,
 * destroy }: update() redraws now (the page calls it from its own render), destroy() stops the timer and listeners.
 */
export function mountCoverage(el, ctx = {}) {
  if (!el) throw new Error('mountCoverage: no element');
  ensureCss();
  const get = (k) => { const v = ctx[k]; try { return typeof v === 'function' ? v() : v; } catch { return null; } };
  let open = false, html = '', dead = false, timer = 0, off = null, offLive = null, watched = null;

  function watch(lv) {
    if (lv === watched) return;
    try { offLive?.(); } catch { /* fine */ }
    offLive = null; watched = lv;
    if (lv && typeof lv.onChange === 'function') { try { offLive = lv.onChange(() => update()); } catch { offLive = null; } }
  }

  function update() {
    if (dead) return;
    const m = get('model'), pb = !!get('playback');
    const lv = pb ? null : get('live');
    watch(lv);
    const ms = Number(get('now')) || Date.now();
    const next = m ? coverageHtml(m, coverageOf(m, lv, ms), { desktop: !!get('isDesktop'), playback: pb, open })
      : coverageHtml(null, null, { desktop: !!get('isDesktop') });
    if (next === html) return;
    html = next;
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    const sig = a && a !== el && el.contains(a) ? sigOf(a) : '';
    el.innerHTML = next;
    if (!sig) return;
    const back = el.querySelector(sig);
    if (back) { if (sig === '.ph h2') back.tabIndex = -1; back.focus({ preventScroll: true }); }
  }

  function onClick(e) {
    const b = e.target?.closest?.('[data-cov="more"]');
    if (!b || !el.contains(b)) return;
    open = !open;
    update();
  }

  el.addEventListener('click', onClick);
  off = onLang(() => { html = ''; update(); });
  timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) update(); }, REFRESH_MS);
  update();
  return {
    el,
    update,
    get open() { return open; },
    destroy() {
      dead = true;
      clearInterval(timer);
      el.removeEventListener('click', onClick);
      try { off?.(); } catch { /* fine */ }
      try { offLive?.(); } catch { /* fine */ }
      watched = null;
    },
  };
}
