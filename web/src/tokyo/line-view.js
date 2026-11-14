// one line. The Tokyo remake of trafik.live/kereta's line screen
// (kereta/views.js lineView: the line chip, the trains running now, its stations as a track), drawn as a schematic
// strip: every station of the line in order, with the trains that are between them now by the timetable, each on its
// side of the line by direction (down the list on the right, up on the left; a loop like the Yamanote Line ends where
// it starts). Tap a station -> its board, a train -> its stops (train-view.js).
//
//   lineView(m, lineRef, ms, st, api, desktop) -> html     lineRef = line.id ('JR-East.Yamanote'), index or the line
//   lineStrip(m, lineRef, ms) -> {line, li, rows [{k, s, first, last, seam}], trains [{run, p, y, dir, state, ...}]}
// Taps: data-station = station.id, data-train = run.id, data-line = line.id. "Scheduled" on the screen (rule 6).

import { esc } from '../app/format.js';
import { list, row, sec } from '../app/ui.js';
import { clock, clockMs, lang, t, title, titleAlt, tn } from './i18n.js';
import { running, suspendedOf } from './model.js';
import {
  altLang, complexOf, destination, dirName, ensureCss, head, isLive, joinSent, joinTo, lName, lineChip, lineIndex, liveLabel, liveState, opName, sName,
  stationTile, toeiCredit, trainColor,
} from './train-view.js';

const firstDep = (r) => r.stops[0].d ?? r.stops[0].a;

/**
 * The line as rows (its stations in order; a loop whose list does not repeat its first station gets it again at the
 * end) and the trains on it now: y = position in rows (k + fraction to the next row), dir = +1 travelling down the
 * list (increasing chain), -1 up; state as model.js's position() (0 moving, 1 at a stop, 2 waiting at its first stop,
 * 3 arrived at its last).
 */
export function lineStrip(m, ref, ms = Date.now()) {
  const li = lineIndex(m, ref), L = m.lines[li];
  if (!L) return null;
  const st = L.stations.slice(), chain = (L.chain || []).slice();
  const loop = !!L.loop;
  if (loop && st.length > 1 && st[0] !== st[st.length - 1]) { st.push(st[0]); chain.push(L.length || chain[chain.length - 1]); }
  const n = st.length, len = loop ? chain[n - 1] : 0;
  const rows = st.map((s, k) => ({ k, s, first: k === 0, last: k === n - 1, seam: loop && (k === 0 || k === n - 1) }));
  // chain metres -> row position (piecewise linear between station rows)
  const yOf = (along) => {
    if (!(n > 1)) return 0;
    if (along <= chain[0]) return 0;
    if (along >= chain[n - 1]) return n - 1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (chain[mid] <= along) lo = mid; else hi = mid; }
    const span = chain[hi] - chain[lo];
    return lo + (span > 0 ? (along - chain[lo]) / span : 0);
  };
  const trains = [];
  for (const p of running(m, ms)) {
    if (p.line !== li) continue;
    const dir = p.sign < 0 ? -1 : 1;
    let along = p.along;
    if (loop && len > 0) along = ((along % len) + len) % len;
    let y = yOf(along);
    // on a loop the first station is both the top and the bottom row: a train leaving it stands where it can move off
    // in its direction, a train arriving where it came in
    if (loop && (y < 0.001 || y > n - 1.001)) {
      const leaving = p.state === 2 || (p.state === 0 && p.stop <= 1);
      y = leaving ? (dir > 0 ? 0 : n - 1) : (dir > 0 ? n - 1 : 0);
    }
    trains.push({ run: p.run, p, y, dir, state: p.state, stop: p.stop });
  }
  trains.sort((a, b) => a.dir - b.dir || a.y - b.y);
  return { line: L, li, loop, rows, trains, n };
}

/** Where a train on the strip is, in words: "Ebisu → Meguro", "at Shibuya", "leaves Osaki 10:02". */
function whereText(m, x) {
  const r = x.run, s = r.stops;
  if (x.state === 0) return t('lv.between', { a: sName(m, s[x.stop - 1]?.s), b: sName(m, s[x.stop]?.s) });
  if (x.state === 2) return t('lv.wait', { name: sName(m, s[0].s), time: clock(firstDep(r)) });
  return t('lv.at', { name: sName(m, s[x.stop]?.s) });
}
/** "To Shibuya" / a loop's direction ("Inner Loop"). */
function toText(m, r) {
  const d = destination(m, r);
  if (d.loop) return dirName(m, r.dir) || lName(m, r.line);
  return t('train.to', { name: joinTo(d.to.map((s) => sName(m, s))) });
}
const typeColor = (m, r) => trainColor(m, r);

/** The two ways along the line: [{dir: +1 | -1, label, n}] (MT3D's direction names when the line has them). */
function ways(m, s) {
  const L = s.line, last = s.rows[s.rows.length - 1].s, first = s.rows[0].s;
  const name = (d, fallback) => (d != null && m.dirs[d] ? dirName(m, d) : fallback);
  const down = name(L.ascending, t('lv.toward', { name: sName(m, last) }));
  const up = name(L.descending, t('lv.toward', { name: sName(m, s.loop ? s.rows[s.rows.length - 2]?.s ?? first : first) }));
  return [{ dir: 1, label: down, n: s.trains.filter((x) => x.dir > 0).length }, { dir: -1, label: up, n: s.trains.filter((x) => x.dir < 0).length }];
}

const liveApi = (api) => api?.live ?? (typeof globalThis !== 'undefined' ? globalThis.__tokyo?.live : null) ?? null;
/**
 * The operator's status for the line (live.status(lineId), ODPT odpt:TrainInformation), when there is one:
 * severity in words, the operator's own text in the page language (Japanese when they give no English, said so), and
 * the time it was issued. '' without live data (no card: nothing changes for scheduled-only lines).
 */
export function statusCard(m, L, api = {}, ms = Date.now()) {
  const live = liveApi(api);
  let s = null;
  try { s = live?.status?.(L.id) || null; } catch { s = null; }
  if (!s || !s.text) return '';
  const ja = lang() === 'ja';
  const text = ja ? s.text.ja || s.text.en : s.text.en || s.text.ja;
  const jaOnly = !ja && !s.text.en && !!s.text.ja;
  const sev = ['normal', 'info', 'delay', 'suspended'].includes(s.severity) ? s.severity : 'info';
  // "as of" = the data time (ODPT dc:date: the record's own, else the operator's newest); a notice's issue time only
  // matters for a disruption ("since 17:05"; Toei's standing "no delay" notice can be a day old)
  let at = Number.isFinite(s.dataAt) ? s.dataAt : null;
  if (at == null) { try { at = live.updatedAt?.(L.id) ?? null; } catch { at = null; } }
  const when = Number.isFinite(at) ? t('tv.asof', { time: clockMs(at) }) : '';
  const since = sev !== 'normal' && Number.isFinite(s.at) && ms - s.at >= 0 && ms - s.at < 86400000 ? t('lv.since', { time: clockMs(s.at) }) : '';
  const resume = Number.isFinite(s.resume) ? t('live.resume', { time: clockMs(s.resume) }) : '';
  const foot = [opName(m, m.lines.indexOf(L)), since, when, jaOnly ? t('live.ja.only') : ''].filter(Boolean).join(' · ');
  return `<section class="lv-status" data-sev="${sev}" aria-label="${esc(t('lv.status'))}"><b>${esc(t(`live.sev.${sev}`))}</b><span${jaOnly ? ' lang="ja"' : ''}>${esc(text)}</span>${resume ? `<span>${esc(resume)}</span>` : ''}<small>${esc(foot)}</small></section>`;
}

function stripHtml(m, s) {
  const L = s.line;
  const rows = s.rows.map((o) => {
    const stn = m.stations[o.s];
    // other lines of the complex, each look once (MT3D splits some lines in parts that share a code and colour)
    const seen = new Set([`${L.code}|${L.color}`]);
    const others = [...new Set(complexOf(m, o.s).map((x) => m.stations[x]?.line).filter((l) => l != null && l !== s.li))]
      .filter((l) => { const k = `${m.lines[l]?.code || m.lines[l]?.id}|${m.lines[l]?.color}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const chips = others.slice(0, 4).map((l) => lineChip(m.lines[l], 'xs')).join('') + (others.length > 4 ? `<small class="lv-plus">+${others.length - 4}</small>` : '');
    // the loop's last row says "Loop: back to Osaki" (page language); else the other-script name, tagged with its language
    const loopEnd = o.seam && o.last;
    const alt = loopEnd ? t('lv.loop', { name: sName(m, o.s) }) : titleAlt(stn?.name);
    const code = stn?.code ? `<small class="tv-code" style="--rc:${esc(L.color || '#6B6B70')}">${esc(stn.code)}</small>` : '';
    // screen readers get what the chips show: the code and the other lines here
    const label = [sName(m, o.s), stn?.code || '', ...others.map((l) => lName(m, l))].filter(Boolean).join(', ');
    return `<button type="button" class="lv-st${o.first ? ' first' : ''}${o.last ? ' last' : ''}" data-station="${esc(stn?.id ?? o.s)}" aria-label="${esc(label)}"><i></i>${code}<span class="n"><span class="nm">${esc(sName(m, o.s))}</span>${alt ? `<small${loopEnd ? '' : ` lang="${altLang()}"`}>${esc(alt)}</small>` : ''}</span>${chips ? `<span class="lv-x">${chips}</span>` : ''}</button>`;
  }).join('');
  const trains = s.trains.map((x) => {
    const label = `${toText(m, x.run)}, ${whereText(m, x)}${x.lv ? `, ${liveLabel(x.lv)}` : ''}`;
    return `<button type="button" class="lv-tr ${x.dir > 0 ? 'dn' : 'up'}${x.state ? ' stand' : ''}${isLive(x.lv) ? ' live' : ''}" style="top:calc(6px + var(--row) * ${(x.y + 0.5).toFixed(3)});--tc:${esc(typeColor(m, x.run))}" data-train="${esc(x.run.id)}" aria-label="${esc(label)}" title="${esc(label)}"><b></b>${isLive(x.lv) ? '<i class="lv-live"></i>' : ''}</button>`;
  }).join('');
  return `<div class="lv-strip" style="--lc:${esc(L.color || '#6B6B70')}">${rows}${trains}</div>`;
}

/**
 * The line screen. st: {} (reserved); api: {stamp (timetable version text)}; desktop: draw the close button.
 */
export function lineView(m, ref, ms = Date.now(), st = {}, api = {}, desktop = false) {
  ensureCss(css);
  const s = lineStrip(m, ref, ms);
  if (!s) return head({ lead: stationTile(), title: t('line.gone'), sub: '', close: desktop });
  const L = s.line, nSt = s.loop ? s.rows.length - 1 : s.rows.length;
  const op = opName(m, s.li);
  // live (ODPT, Toei today): measured trains get a mark and their label; the rest stay "Scheduled"
  for (const x of s.trains) x.lv = liveState(m, x.run, api);
  // measured only (an estimate keeps its own words, never counts as live)
  const nLive = s.trains.filter((x) => isLive(x.lv)).length, live = liveApi(api);
  let at = null;
  if (nLive) { try { at = live?.updatedAt?.(L.id) ?? null; } catch { at = null; } }
  const asof = Number.isFinite(at) ? t('tv.asof', { time: clockMs(at) }) : '';
  // some live: say what the rest are
  const how = !nLive ? t('sched') : nLive === s.trains.length ? t('lv.live.all') : `${t('lv.live.some', { n: nLive })} · ${t('lv.sched.rest', { n: s.trains.length - nLive })}`;
  const sub = [op && op !== lName(m, s.li) ? op : '', tn('n.stations', nSt), s.trains.length ? tn('lv.running', s.trains.length) : '', how, asof].filter(Boolean).join(' · ');
  const w = ways(m, s);
  const legend = `<div class="lv-dirs">${w.map((x) => `<span class="lv-dir"><i class="${x.dir > 0 ? 'dn' : 'up'}" style="--tc:${esc(L.color || '#6B6B70')}"></i>${esc(x.label)}<b>${esc(String(x.n))}</b></span>`).join('')}</div>`;
  const trainRows = s.trains.map((x) => row({
    attrs: `data-train="${esc(x.run.id)}"`, lead: `<span class="lv-lead ${x.dir > 0 ? 'dn' : 'up'}${isLive(x.lv) ? ' live' : ''}" style="--tc:${esc(typeColor(m, x.run))}" aria-hidden="true"><b></b>${isLive(x.lv) ? '<i class="lv-live"></i>' : ''}</span>`,
    // where first, the live words last
    title: toText(m, x.run), sub: `${whereText(m, x)} · ${[title(m.types[x.run.type]?.title), x.run.number].filter(Boolean).join(' ')}${x.lv ? ` · ${liveLabel(x.lv)}` : ''}`, chev: true,
  }));
  const stamp = api.stamp ? ` ${esc(t('tv.stamp', { stamp: api.stamp }))}` : '';
  const small = !nLive ? t('sched') : nLive === s.trains.length ? t('lv.live.all') : t('lv.live.some', { n: nLive });
  // ODPT's credit only for ODPT data
  let credit = '';
  if (nLive) { try { credit = live?.creditOf?.(L.id) || ''; } catch { credit = ''; } }
  if (nLive && !credit) credit = toeiCredit(String(L.id).split('.')[0]);
  // a suspended line (model.js SUSPENDED, e.g. Isumi): ONE calm line instead of the strip and "No trains" (no runs drawn)
  const susp = suspendedOf(m, s.li);
  if (susp) {
    return `${head({ lead: lineChip(L, 'xl'), title: lName(m, s.li), sub: [op && op !== lName(m, s.li) ? op : '', tn('n.stations', nSt)].filter(Boolean).join(' · '), close: desktop })}
    ${statusCard(m, L, api, ms)}
    <section class="lv-status" data-sev="suspended"><b>${esc(t(susp.bus ? 'line.suspended' : 'line.suspended.nobus'))}</b></section>`;
  }
  return `${head({ lead: lineChip(L, 'xl'), title: lName(m, s.li), sub, close: desktop })}
    ${statusCard(m, L, api, ms)}
    ${legend}
    ${sec(t('lv.strip'), small, stripHtml(m, s))}
    ${sec(t('lv.trains'), small, trainRows.length ? list(trainRows) : `<p class="tv-none">${esc(t('lv.none'))}</p>`)}
    <p class="tv-note">${esc(joinSent([nLive ? t('lv.note.live') : t('lv.note'), credit]))}${stamp}</p>`;
}

// ------------------------------------------------------------------ styles (injected with train-view's)
export const css = `
.lv-dirs{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.lv-dir{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px 0 10px;border-radius:999px;background:var(--panel);font:500 13px/1 var(--font);color:var(--text);white-space:nowrap}
.lv-dir b{font-weight:700;font-variant-numeric:tabular-nums;color:var(--text2)}
.lv-dir i,.lv-lead b{position:relative;flex:none;width:10px;height:16px;border-radius:4px 4px 3px 3px;background:var(--tc)}
.lv-dir i::before,.lv-lead b::before{content:"";position:absolute;left:2px;right:2px;top:2px;height:4px;border-radius:2px;background:rgba(20,20,24,.8)}
.lv-dir i.dn,.lv-lead.dn b{transform:rotate(180deg)}
.lv-strip{position:relative;display:grid;grid-template-columns:minmax(0,1fr);min-width:0;border-radius:18px;background:var(--panel);padding:6px 0;--row:44px;--lx:46px}
.lv-st{position:relative;display:flex;align-items:center;gap:8px;min-width:0;height:var(--row);padding:0 12px 0 86px;width:100%;text-align:left;color:var(--text);background:none}
.lv-st::before{content:"";position:absolute;left:calc(var(--lx) - 2px);top:0;bottom:0;width:4px;background:var(--lc)}
.lv-st.first::before{top:50%}
.lv-st.last::before{bottom:50%}
.lv-st > i{position:absolute;left:calc(var(--lx) - 7px);top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 3px var(--lc)}
.lv-st .n{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;font:500 15px/19px var(--font);white-space:nowrap;overflow:hidden}
.lv-st .n .nm{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.lv-st .n small{flex:none;max-width:100%;font:400 13px/16px var(--font);color:var(--text3);overflow:hidden;text-overflow:ellipsis}
.lv-x{flex:none;display:flex;align-items:center;gap:3px}
.lv-plus{font:600 13px/1 var(--font);color:var(--text2)}
.lv-tr{position:absolute;width:44px;height:44px;margin-top:-22px;display:grid;place-items:center;background:none;z-index:1;padding:0}
.lv-tr.up{left:calc(var(--lx) - 42px)}
.lv-tr.dn{left:calc(var(--lx) - 2px)}
.lv-tr b{position:relative;width:14px;height:26px;border-radius:6px 6px 4px 4px;background:var(--tc);box-shadow:0 0 0 2px #fff,0 2px 6px rgba(16,24,40,.28)}
.lv-tr b::before{content:"";position:absolute;left:2px;right:2px;top:3px;height:5px;border-radius:2px;background:rgba(20,20,24,.82)}
.lv-tr b::after{content:"";position:absolute;left:3px;right:3px;top:11px;bottom:4px;border-radius:1px;background:repeating-linear-gradient(rgba(255,255,255,.78) 0 2px,transparent 2px 4px)}
.lv-tr.dn b{transform:rotate(180deg)}
.lv-tr:focus-visible{outline:2px solid var(--chart);outline-offset:-6px;border-radius:12px}
.lv-lead{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--elevated)}
.lv-lead b{width:12px;height:20px}
.lv-tr .lv-live,.lv-lead .lv-live{position:absolute;width:8px;height:8px;border-radius:50%;background:var(--income);box-shadow:0 0 0 2px #fff}
.lv-tr .lv-live{left:calc(50% + 5px);top:6px}
.lv-lead{position:relative}
.lv-lead .lv-live{right:7px;top:7px}
.lv-status{display:grid;gap:3px;padding:11px 14px 12px;border-radius:18px;background:var(--panel);min-width:0}
.lv-status b{font:600 14px/18px var(--font);color:#157A39}
.lv-status span{font:400 14px/19px var(--font);color:var(--text)}
.lv-status small{font:400 13px/17px var(--font);color:var(--text2)}
.lv-status[data-sev="info"] b{color:var(--text)}
.lv-status[data-sev="delay"],.lv-status[data-sev="suspended"]{background:var(--warning-soft)}
.lv-status[data-sev="delay"] b,.lv-status[data-sev="suspended"] b{color:#B54708}
.tv-none{margin:0;padding:12px 14px 14px;font:400 13px/18px var(--font);color:var(--text2);border-radius:18px;background:var(--panel)}
@media (hover:hover){.lv-st:hover .n{text-decoration:underline;text-decoration-color:var(--border)}.lv-tr:hover b{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--tc)}}
`;
