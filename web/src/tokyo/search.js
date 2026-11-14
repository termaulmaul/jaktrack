// Tokyo station and line search, in the way of trafik.live's own search
// (app/search.js, krl/panes.js searchBlock): built once from the unpacked network pack, then every keystroke is one
// pass over precomputed keys (well under a millisecond here, a few on a phone).
//
// Forgiving: case, macrons (Ōsaki), long vowels written any way (Oosaki, Ohsaki, Osaki), Kunrei and typing-style
// romaji (Sinjuku, Shinjyuku, Tyofu), hyphens and spaces (Nishi-Nippori, Nishinippori), m/n before b/p
// (Shimbashi, Shinbashi), one typo from 4 letters (akihabra), kanji and kana (新宿, しんじゅく, シンジュク,
// 霞が関 = 霞ケ関, 丸の内線 = 丸ノ内線), Korean and Chinese titles when the pack carries them, station numbers (JY17,
// G9, "jy 17") and line codes (JY, G), line names (Ginza, 銀座線, Yamanote, Toei Shinjuku).
//
// Results: one row per station complex (model.groups; a station without a group is its own complex) with the lines
// it serves, then lines (branches that share a name and colour fold into one row). Rank: exact > prefix > whole word
// > word start > substring > one typo; busier hubs (more lines) first on ties.
//
// Station names and line titles are Mini Tokyo 3D data (c) Akihiko Kusanagi, MIT licence.

import { esc } from '../app/format.js';
import { emptyState, icon, list, row, sec } from '../app/ui.js';
import { lineChip } from './types.js';

// ================================================================== text keys
const MARKS = /[\u0300-\u036f]/g;
/** Lower case, full width -> ASCII and half-width kana -> full (NFKC), accents and macrons dropped ("Ōsaki" -> "osaki"). */
export const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase().normalize('NFD').replace(MARKS, '').normalize('NFC');

/**
 * One spelling for the ways people write the same romaji: Kunrei and typing styles -> Hepburn (si shi, ti chi,
 * tu tsu, hu fu, zi/di ji, du zu, sya sha, tya cha, zya/jya ja), m -> n before b/p/m, wapuro cch -> tch, long vowels
 * folded (oo, ou, oh before a consonant -> o; uu -> u). Applied to names and queries alike, so it only has to agree
 * with itself, never be "correct" romaji.
 */
// one pass, leftmost match first (the same result as applying the rules one after another, at a tenth of the cost)
const ROMAJI_RE = /shy(?=[aeiou])|chy(?=[aeiou])|sy(?=[aeiou])|[tc]y(?=[aeiou])|[jzd]y(?=[aeiou])|si|ti|tu|[zd]i|du|[sc]hu|hu|m(?=[bpm])|cch|oh(?![aeiou])|o[ou]+|uu+/g;
const ROMAJI_TO = {
  shy: 'sh', chy: 'ch', sy: 'sh', ty: 'ch', cy: 'ch', jy: 'j', zy: 'j', dy: 'j', si: 'shi', ti: 'chi', tu: 'tsu', zi: 'ji',
  di: 'ji', du: 'zu', shu: 'shu', chu: 'chu', hu: 'fu', m: 'n', cch: 'tch', oh: 'o',
};
export const romaji = (w) => (w ? w.replace(ROMAJI_RE, (m) => ROMAJI_TO[m] || m[0]) : '');

/** Station numbers and line codes: letters + digits only, leading zeros dropped ("JY-01" -> "jy1", "G09" -> "g9"). */
export const codeKey = (s) => fold(s).replace(/[^a-z0-9]+/g, '').replace(/(^|\D)0+(\d)/g, '$1$2');

// spelling twins in Japanese names: 霞ケ関 / 霞が関 / 霞ヶ関, 丸ノ内 / 丸の内, 堀之内 / 堀の内, 四ツ谷 / 四谷
const CJK_TWIN = { 'ヶ': 'ケ', 'が': 'ケ', 'ガ': 'ケ', 'ヵ': 'カ', 'ノ': 'の', '之': 'の', '髙': '高' };
const CJK_TWIN_RE = /[ヶがガヵノ之髙]/g;
const HAN = '\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005';
const TSU_RE = new RegExp(`([${HAN}])[ツつッっ](?=[${HAN}])`, 'g');
/** Key for Japanese / Chinese / Korean text: NFKC, no spaces or dots or brackets, spelling twins merged. */
export const cjkKey = (s) => String(s ?? '').normalize('NFKC').toLowerCase()
  .replace(/[\s・･·\-‐‑–—()（）<>〈〉《》「」『』[\]【】]/g, '')
  .replace(CJK_TWIN_RE, (c) => CJK_TWIN[c])
  .replace(TSU_RE, '$1');

const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su',
  せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho', ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu',
  よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', が: 'ga', ぎ: 'gi',
  ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de',
  ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ゕ: 'ka', ゖ: 'ke', ゎ: 'wa',
};
const SMALL_V = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
/** Kana -> Hepburn romaji ("しんじゅく" / "シンジュク" -> "shinjuku"), so a phone IME's kana finds romaji names. */
export function kanaToRomaji(s) {
  let out = '';
  let dbl = false;
  for (const ch0 of String(s ?? '').normalize('NFKC')) {
    const cp = ch0.codePointAt(0);
    const ch = cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : ch0;
    if (ch === 'っ') { dbl = true; continue; }
    if (ch === 'ー') continue;   // long vowel mark: romaji keys fold long vowels anyway
    if (SMALL_Y[ch]) {
      const v = SMALL_Y[ch];
      if (/(sh|ch|j)i$/.test(out)) out = out.slice(0, -1) + v;
      else if (/[kgnhbpmrv]i$/.test(out)) out = `${out.slice(0, -1)}y${v}`;
      else out += `y${v}`;
      continue;
    }
    if (SMALL_V[ch]) {
      const v = SMALL_V[ch];
      if (/(^|[aeiou])u$/.test(out)) out = `${out.slice(0, -1)}w${v}`;   // うぃ -> wi
      else if (/[^aeiou][aeiou]$/.test(out)) out = out.slice(0, -1) + v;   // ふぁ -> fa, てぃ -> ti
      else out += v;
      continue;
    }
    let r = KANA[ch];
    if (r == null) { out += ' '; dbl = false; continue; }
    if (dbl) { r = (r.startsWith('ch') ? 't' : r[0]) + r; dbl = false; }
    out += r;
  }
  return out.trim();
}

// words a query may carry that names lack ("Shinjuku station", "Yamanote line", "Ginza sen"): they count when they
// match, and a name without them still matches
const WEAK = new Set(['station', 'sta', 'stn', 'eki', 'line', 'sen', 'the']);
// suffixes typed after a name: 駅 (station), 站 (zh), 역 (ko)
const SUFFIX_RE = /(駅|站|역)$/;
const LINE_SUFFIX_RE = /(線|线|선|ライン)$/;

/** Latin text -> { words, core, full, key }: canonical words and compact keys (with and without weak words). */
function latinKeys(text) {
  const raw = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  const strong = raw.filter((w) => !WEAK.has(w));
  const coreRaw = strong.length ? strong : raw;
  return {
    words: raw.map(romaji),
    core: coreRaw.map(romaji),
    full: romaji(raw.join('')),
    key: romaji(coreRaw.join('')),
  };
}

const CJK_RE = new RegExp(`[\\u3040-\\u30ff\\u31f0-\\u31ff${HAN}]`);
const KANA_ONLY_RE = /^[\u3040-\u30ff\u31f0-\u31ff\s\u30fb\uff65]+$/;
const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;

// ================================================================== matching
/** Is q[qi..] the start of w[wi..]? */
function startsAt(q, qi, w, wi) {
  const len = q.length - qi;
  if (len <= 0) return true;
  if (w.length - wi < len) return false;
  for (let k = 0; k < len; k++) if (q.charCodeAt(qi + k) !== w.charCodeAt(wi + k)) return false;
  return true;
}
/** One edit (a letter wrong, missing, extra, or two swapped) turns q into the start of w. No allocation. */
export function nearStart(q, w) {
  const m = q.length;
  const n = w.length;
  let i = 0;
  while (i < m && i < n && q.charCodeAt(i) === w.charCodeAt(i)) i++;
  if (i === m) return true;
  return startsAt(q, i + 1, w, i + 1)   // a letter wrong
    || startsAt(q, i + 1, w, i)         // an extra letter in q
    || startsAt(q, i, w, i + 1)         // a letter missing in q
    || (i + 1 < m && i + 1 < n && q.charCodeAt(i) === w.charCodeAt(i + 1) && q.charCodeAt(i + 1) === w.charCodeAt(i) && startsAt(q, i + 2, w, i + 2));
}

// score tiers (higher is better); alias names (the 〈原宿〉 in 明治神宮前〈原宿〉, 線-less line names) a little lower
const EXACT = 1000;
const PREFIX = 800;
const WORD = 750;        // every query word is a whole word of the name ("Ueno" in "Keisei Ueno")
const WORD_START = 700;  // every query word starts a word of the name ("san" in "Shinjuku-sanchome")
const SUBSTR = 500;
const FUZZY = 300;
const ALIAS = 30;
const HOW = (s) => (s >= EXACT - ALIAS ? 'exact' : s >= PREFIX - ALIAS ? 'prefix' : s >= WORD_START - ALIAS ? 'word' : s >= SUBSTR - ALIAS ? 'substring' : 'fuzzy');

/** Score one latin entry ({key, full, words}) against a prepared latin query. */
function scoreLatin(e, Q) {
  const k = e.key;
  if (k === Q.key || k === Q.full || e.full === Q.full) return EXACT;
  if (k.startsWith(Q.key)) return PREFIX;
  // word by word: each strong query word must hit a word of the name
  let lvl = 3;
  const ws = e.words;
  for (let a = 0; a < Q.core.length && lvl; a++) {
    const t = Q.core[a];
    let best = 0;
    for (let b = 0; b < ws.length; b++) {
      const w = ws[b];
      if (w === t) { best = 3; break; }
      if (best < 2 && w.startsWith(t)) best = 2;
      else if (best < 1 && t.length >= 4 && w.charCodeAt(0) === t.charCodeAt(0) && nearStart(t, w)) best = 1;
    }
    if (best < lvl) lvl = best;
  }
  if (lvl === 3) return WORD;
  if (lvl === 2) return WORD_START;
  // inside a word ("kitazawa" in "Shimokitazawa"), never across words ("ueno" in "odakyu enoshima")
  const ql = Q.key.length;
  if (ql >= 3) {
    if (Q.core.length > 1) { if (k.includes(Q.key)) return SUBSTR; } else for (let b = 0; b < ws.length; b++) if (ws[b].includes(Q.key)) return SUBSTR;
  }
  if (lvl === 1) return FUZZY;
  // one typo over the whole name, first letter right ("akihabra", not "ginza" -> "Inzai")
  if (ql >= 4 && k.charCodeAt(0) === Q.key.charCodeAt(0) && nearStart(Q.key, k)) return FUZZY;
  return 0;
}

/** Score a CJK / Korean entry key against a query key: exact, prefix, substring (no typo matching for kanji). */
function scoreKey(k, q) {
  if (k === q) return EXACT;
  if (k.startsWith(q)) return PREFIX;
  if (k.includes(q)) return SUBSTR;
  return 0;
}

// ================================================================== the index
const humanOp = (id) => String(id || '').split('.')[0].replace(/-/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
/** "Meiji-jingumae<Harajuku>" -> ["Meiji-jingumae", "Harajuku"]; "明治神宮前〈原宿〉" -> ["明治神宮前", "原宿"]. */
function splitAlias(s) {
  const m = /^(.*?)\s*[<(〈（]\s*([^>)〉）]+?)\s*[>)〉）]\s*$/.exec(String(s || ''));
  return m && m[1] ? [m[1], m[2]] : [String(s || '')];
}
/** A name as shown: "Meiji-jingumae<Harajuku>" -> "Meiji-jingumae (Harajuku)", "押上<スカイツリー前>" -> "押上〈スカイツリー前〉". */
export function showName(s, lang = 'en') {
  const [main, alias] = splitAlias(s);
  if (!alias) return main;
  return lang === 'ja' ? `${main}〈${alias}〉` : `${main} (${alias})`;
}
const nameIn = (o, lang) => (lang === 'ja' ? o?.ja || o?.en : o?.en || o?.ja) || '';
const otherIn = (o, lang) => (lang === 'ja' ? o?.en : o?.ja) || '';
const codesOf = (v) => (Array.isArray(v) ? v : v == null ? [] : String(v).split(/[\s,/;]+/)).filter(Boolean);

/**
 * The search for one network. Cheap to call: the index is built on the first query / near (about 30 ms here, ~100 ms
 * on a phone), or earlier with warm() when the page is idle.
 * @param net  unpacked network pack (net.js unpackNet output, or the model.js fixture's model): lines, stations, groups,
 *             operators. Station `name` / line `title` may carry any languages; every one present is searched.
 * @param codes optional codes-v1.json ({ lines: { id: { code, color } | code }, stations: { id: 'JY17' | [...] } }).
 */
export function createSearch(net, codes = null) {
  let built = null;
  const get = () => (built ||= buildSearch(net, codes));
  const none = (q) => ({ q: String(q ?? '').trim(), lead: 'stations', first: null, stations: [], lines: [], ms: 0 });
  return {
    /** query(q, lang, limit): see buildSearch */
    query: (q, lang, limit) => (String(q ?? '').trim() ? get().query(q, lang, limit) : none(q)),
    near: (lng, lat, n, lang) => get().near(lng, lat, n, lang),
    line: (i) => net?.lines?.[i],
    lineCode: (i) => get().lineCode(i),
    lineColor: (i) => get().lineColor(i),
    stats: () => get().stats(),
    /** build the index now and run two throwaway queries so the first keystroke is already compiled
     *  (call from requestIdleCallback after the first paint) */
    warm: () => { const b = get(); b.query('shinj', 'en', 4); b.query('新', 'ja', 4); },
    ready: () => !!built,
  };
}

function buildSearch(net, codes) {
  const st = net?.stations || [];
  const ln = net?.lines || [];
  const ops = net?.operators || net?.ops || [];
  const N = st.length;
  const lng = new Float64Array(N);
  const lat = new Float64Array(N);
  // 27 far-away MT3D stations (Sendai, Nagano...) have no coordinate: NaN keeps them out of near()
  const num = (v) => (v == null || v === '' ? NaN : +v);
  for (let s = 0; s < N; s++) { lng[s] = num(st[s].lng); lat[s] = num(st[s].lat); }
  // names repeat (6 stations called Shinjuku): key each spelling once
  const memo = new Map();
  const lk = (text) => { let k = memo.get(text); if (!k) { k = latinKeys(text); memo.set(text, k); } return k; };
  // each station's own name as one key ("Nishi-Nippori" = "Nishi-nippori"), for complex names and transfer lists
  const nk = st.map((x) => lk(splitAlias(x.name?.en || x.id)[0]).full);

  // ---- complexes: model.groups (or station.group), a station without one is its own
  const cxOf = new Int32Array(N).fill(-1);
  const cxs = [];
  const groups = Array.isArray(net?.groups) && net.groups.length ? net.groups : null;
  if (groups) {
    groups.forEach((members, g) => {
      const ms = (members || []).filter((s) => s >= 0 && s < N && cxOf[s] < 0);
      if (!ms.length) return;
      for (const s of ms) cxOf[s] = cxs.length;
      cxs.push({ g, members: ms });
    });
  } else {
    const byG = new Map();
    for (let s = 0; s < N; s++) {
      const g = st[s].group;
      if (g == null || g < 0) continue;
      if (!byG.has(g)) { byG.set(g, cxs.length); cxs.push({ g, members: [] }); }
      cxOf[s] = byG.get(g);
      cxs[cxOf[s]].members.push(s);
    }
  }
  for (let s = 0; s < N; s++) if (cxOf[s] < 0) { cxOf[s] = cxs.length; cxs.push({ g: st[s].group ?? -1, members: [s] }); }
  const C = cxs.length;
  const stationCodes = (s) => {
    const out = codesOf(st[s].code);
    for (const c of codesOf(codes?.stations?.[st[s].id])) if (!out.includes(c)) out.push(c);
    return out;
  };
  for (const cx of cxs) {
    const seen = new Set();
    cx.lines = [];
    for (const s of cx.members) { const l = st[s].line; if (l != null && l >= 0 && !seen.has(l)) { seen.add(l); cx.lines.push(l); } }
    // the complex's own name: the one most of its stations carry ("Ueno" over "Keisei-Ueno"), first on ties
    const count = new Map();
    for (const s of cx.members) count.set(nk[s], (count.get(nk[s]) || 0) + 1);
    let main = cx.members[0];
    let most = 0;
    for (const s of cx.members) { const n = count.get(nk[s]); if (n > most) { most = n; main = s; } }
    cx.main = main;
  }

  // ---- station name entries, one per (complex, spelling); lists dedupe twins like Nishi-Nippori / Nishi-nippori
  const LAT = [];
  const CJK = [];
  const KO = [];
  const CODE = [];
  const per = new Map();
  const add = (arr, kind, c, s, key, extra) => {
    if (!key) return;
    const id = `${kind}|${c}|${key}`;
    const e = per.get(id);
    if (e) {
      if (!e.stations.includes(s)) e.stations.push(s);
      if (e.alias && !extra.alias) { e.alias = false; e.s = s; }
      return;
    }
    const ne = { c, s, key, stations: [s], alias: false, ...extra };
    per.set(id, ne);
    arr.push(ne);
  };
  for (let s = 0; s < N; s++) {
    const c = cxOf[s];
    const names = st[s].name || {};
    for (const [lang, v] of Object.entries(names)) {
      if (!v || typeof v !== 'string') continue;
      // "Meiji-jingumae<Harajuku>": the name, the bracket alias, and the whole string as typed or pasted
      const parts = splitAlias(v);
      if (parts.length > 1) parts.push(v);
      parts.forEach((p, i) => {
        const alias = i === 1;
        if (lang === 'ko') add(KO, 'ko', c, s, cjkKey(p), { alias });
        else if (lang === 'ja' || lang.startsWith('zh')) add(CJK, 'cjk', c, s, cjkKey(p), { alias });
        else if (lang === 'en') {
          const k = lk(p);
          add(LAT, 'lat', c, s, k.full, { alias, full: k.full, words: k.words });
        }
      });
    }
    // MT3D's unique title ("Nakano (Tokyo)", "Asakusa (Tsukuba Express)"): "nakano tokyo" finds the right one
    const un = st[s].uname?.en;
    if (un) { const k = lk(un); add(LAT, 'lat', c, s, k.full, { alias: true, un: true, full: k.full, words: k.words }); }
    for (const code of stationCodes(s)) add(CODE, 'code', c, s, codeKey(code), { text: code });
  }
  per.clear();
  memo.clear();

  // ---- line families: branches that share operator, name and colour ("Musashino Line" x5) are one row
  const fams = [];
  {
    const byKey = new Map();
    ln.forEach((l, i) => {
      const k = `${String(l.id || '').split('.')[0]}|${fold(l.title?.en || l.id)}|${l.color || ''}`;
      if (!byKey.has(k)) { byKey.set(k, fams.length); fams.push({ ids: [], members: [] }); }
      const f = fams[byKey.get(k)];
      f.members.push(i);
    });
    for (const f of fams) {
      f.main = f.members.reduce((a, b) => ((ln[b].stations?.length || 0) > (ln[a].stations?.length || 0) ? b : a), f.members[0]);
      f.ids = f.members.map((i) => ln[i].id);
    }
  }
  const lineCode = (i) => {
    const l = ln[i];
    const fromCodes = codes?.lines?.[l.id];
    return l.code || (typeof fromCodes === 'string' ? fromCodes : fromCodes?.code) || null;
  };
  const lineCodes = (i) => {
    const out = codesOf(lineCode(i));
    for (const c of codesOf(codes?.lines?.[ln[i].id]?.codes)) if (!out.includes(c)) out.push(c);
    return out;
  };
  const lineColor = (i) => ln[i].color || codes?.lines?.[ln[i].id]?.color || '#8E8E93';
  const opTitle = (i) => ops[ln[i].op]?.title || null;
  // the operator's short name (net.js ops[i].short, "Toei" / "都営"), else its title without the bracket
  // ("Toei (Tokyo Metropolitan Bureau of Transportation)" -> "Toei"), else the line id's prefix
  const opNames = (i, lang) => {
    const o = ops[ln[i].op];
    const pick = (x) => (lang === 'ja' ? x?.ja : x?.en) || '';
    return [...new Set([pick(o?.short), splitAlias(pick(o?.title))[0]].filter(Boolean))];
  };
  const opShort = (i, lang) => opNames(i, lang)[0] || (lang === 'ja' ? '' : humanOp(ln[i].id));
  const LLAT = [];
  const LCJK = [];
  const LKO = [];
  const LCODE = [];
  fams.forEach((f, fi) => {
    const L = ln[f.main];
    const t = L.title || {};
    const opEn = opNames(f.main, 'en');
    if (!opEn.length) opEn.push(humanOp(L.id));
    const opJa = opNames(f.main, 'ja');
    const seen = new Map([[LLAT, new Set()], [LCJK, new Set()], [LKO, new Set()], [LCODE, new Set()]]);
    const addL = (arr, key, extra = {}) => {
      if (!key || seen.get(arr).has(key)) return;
      seen.get(arr).add(key);
      arr.push({ f: fi, key, alias: false, ...extra });
    };
    for (const [lang, v] of Object.entries(t)) {
      if (!v || typeof v !== 'string') continue;
      if (lang === 'en') {
        for (const [text, alias] of [[v, false], ...opEn.map((o) => [`${o} ${v}`, true])]) {
          const k = latinKeys(text);
          addL(LLAT, k.key, { full: k.full, words: k.words, alias });
          if (k.full !== k.key) addL(LLAT, k.full, { full: k.full, words: k.words, alias });
        }
      } else if (lang === 'ko' || lang === 'ja' || lang.startsWith('zh')) {
        const arr = lang === 'ko' ? LKO : LCJK;
        const parts = splitAlias(v);
        if (parts.length > 1) parts.push(v);   // 川越線(川越-高麗川間): both halves and the whole title
        parts.forEach((p, pi) => {
          const k = cjkKey(p);
          addL(arr, k, { alias: pi === 1 });
          const bare = k.replace(LINE_SUFFIX_RE, '');
          if (bare && bare !== k) addL(arr, bare, { alias: true });
          if (lang === 'ja') for (const o of opJa) addL(arr, cjkKey(o) + k, { alias: true });
        });
      }
    }
    for (const i of f.members) for (const c of lineCodes(i)) addL(LCODE, codeKey(c), { text: c });
  });

  // ---- per-query scratch (reused: no allocation per station)
  const cxScore = new Float64Array(C);
  const cxEntry = new Array(C).fill(null);
  const cxStamp = new Int32Array(C);
  const fScore = new Float64Array(fams.length);
  const fStamp = new Int32Array(fams.length);
  let stamp = 0;

  const better = (e, s, old) => {
    if (!old) return true;
    if (s !== old.score) return s > old.score;
    if (e.alias !== old.e.alias) return !e.alias;
    if (e.stations?.length !== old.e.stations?.length) return (e.stations?.length || 0) > (old.e.stations?.length || 0);
    return e.key.length < old.e.key.length;
  };
  const hitC = [];
  const putC = (e, s) => {
    if (!s) return;
    if (e.alias) s -= ALIAS;
    const c = e.c;
    if (cxStamp[c] !== stamp) { cxStamp[c] = stamp; cxScore[c] = 0; cxEntry[c] = null; hitC.push(c); }
    if (better(e, s, cxEntry[c])) { cxScore[c] = s; cxEntry[c] = { e, score: s }; }
  };
  const hitF = [];
  const fEntry = [];
  const putF = (e, s) => {
    if (!s) return;
    if (e.alias) s -= ALIAS;
    const f = e.f;
    if (fStamp[f] !== stamp) { fStamp[f] = stamp; fScore[f] = 0; fEntry[f] = null; hitF.push(f); }
    if (s > fScore[f]) { fScore[f] = s; fEntry[f] = e; }
  };

  const display = (s, lang) => showName(nameIn(st[s].name, lang) || st[s].id, lang);
  /** Two rows with one name ("Nakano" in Tokyo and in Gunma): show MT3D's unique titles, "Nakano (Tokyo)". */
  const unique = (rows, lang) => {
    const n = new Map();
    for (const r of rows) n.set(r.name, (n.get(r.name) || 0) + 1);
    for (const r of rows) if (n.get(r.name) > 1) { const u = nameIn(st[r.s].uname, lang); if (u) r.name = u; }
    return rows;
  };

  /** Row data for complex c shown as station s (the matched spelling): name, other script, lines (s's name first). */
  function complexRow(c, s, lang) {
    const cx = cxs[c];
    const first = [];
    const rest = [];
    const seen = new Set();
    for (const m of cx.members) {
      const l = st[m].line;
      if (l == null || l < 0 || seen.has(l)) continue;
      seen.add(l);
      (nk[m] === nk[s] ? first : rest).push(l);
    }
    first.sort((a, b) => a - b);
    rest.sort((a, b) => a - b);
    const others = [];
    const seenN = new Set([nk[s]]);
    for (const m of cx.members) {
      if (seenN.has(nk[m])) continue;
      seenN.add(nk[m]);
      others.push(display(m, lang));
    }
    const other = otherIn(st[s].name, lang);
    return {
      c, g: cx.g, s, id: st[s].id, name: display(s, lang), other: other ? showName(other, lang === 'ja' ? 'en' : 'ja') : '',
      lines: [...first, ...rest], others, hub: cx.lines.length,
    };
  }
  function lineRow(f, lang) {
    const i = fams[f].main;
    const L = ln[i];
    return {
      i, id: L.id, ids: fams[f].ids, name: nameIn(L.title, lang) || L.id, other: otherIn(L.title, lang) || '',
      code: lineCode(i), color: lineColor(i), op: opShort(i, lang),
      stations: new Set(fams[f].members.flatMap((m) => ln[m].stations || [])).size,
    };
  }

  /**
   * @param {string} q   what was typed
   * @param {string} lang 'en' | 'ja' | 'id' (names shown in this language; ID uses the English names)
   * @param {number} limit station rows (lines: up to the same when lines lead, else about half)
   * @returns {{q, lead: 'stations'|'lines', first: {t, id}|null, stations: object[], lines: object[], ms: number}}
   */
  function query(q, lang = 'en', limit = 8) {
    const t0 = now();
    const raw = String(q ?? '').normalize('NFKC').trim();
    const empty = { q: raw, lead: 'stations', first: null, stations: [], lines: [], ms: 0 };
    if (!raw) return empty;
    stamp++;
    hitC.length = 0;
    hitF.length = 0;
    const hasCJK = CJK_RE.test(raw);
    const hasKo = HANGUL_RE.test(raw);
    // latin: typed romaji, or the romaji of kana typed through a phone IME
    let Q = null;
    if (!hasCJK && !hasKo) Q = latinKeys(raw);
    else if (hasCJK && KANA_ONLY_RE.test(raw)) Q = latinKeys(kanaToRomaji(raw.replace(/(えき|エキ)$/, '')));
    if (Q && !Q.key) Q = null;
    if (Q) {
      const many = Q.core.length > 1;   // the "(Tokyo)" of "Nakano (Tokyo)" counts only next to the name
      for (let i = 0; i < LAT.length; i++) if (many || !LAT[i].un) putC(LAT[i], scoreLatin(LAT[i], Q));
      for (let i = 0; i < LLAT.length; i++) putF(LLAT[i], scoreLatin(LLAT[i], Q));
    }
    if (hasCJK) {
      // as typed ("空港第2ビル", "YRP野比"), and without latin letters when mixed in ("JR新宿" -> 新宿)
      const k = cjkKey(raw).replace(SUFFIX_RE, '');
      const bare = /[a-z]/i.test(raw) ? cjkKey(raw.replace(/[a-z]+/gi, '')).replace(SUFFIX_RE, '') : '';
      for (const key of bare && bare !== k ? [k, bare] : [k]) {
        if (!key) continue;
        for (let i = 0; i < CJK.length; i++) putC(CJK[i], scoreKey(CJK[i].key, key));
        for (let i = 0; i < LCJK.length; i++) putF(LCJK[i], scoreKey(LCJK[i].key, key));
      }
    }
    if (hasKo) {
      const k = cjkKey(raw).replace(SUFFIX_RE, '');
      if (k) {
        for (let i = 0; i < KO.length; i++) putC(KO[i], scoreKey(KO[i].key, k));
        for (let i = 0; i < LKO.length; i++) putF(LKO[i], scoreKey(LKO[i].key, k));
      }
    }
    // station numbers and line codes (JY, G)
    const ck = !hasCJK && !hasKo ? codeKey(raw) : '';
    if (ck && ck.length <= 6 && /^[a-z]{1,3}\d{0,3}[a-z]?$/.test(ck)) {
      const digit = /\d/.test(ck);
      if (digit) {
        for (let i = 0; i < CODE.length; i++) {
          const e = CODE[i];
          putC(e, e.key === ck ? EXACT + 5 : e.key.startsWith(ck) ? PREFIX : 0);
        }
      } else {
        for (let i = 0; i < LCODE.length; i++) if (LCODE[i].key === ck) putF(LCODE[i], EXACT + 5);
      }
    }

    // typo matches only when nothing better turned up: "akihabra" finds Akihabara, "Tokyo" does not list Toyoda
    let cs = hitC.slice();
    let fs = hitF.slice();
    const isFuzzy = (x) => x < SUBSTR - ALIAS;
    const good = cs.reduce((n, c) => n + !isFuzzy(cxScore[c]), 0) + fs.reduce((n, f) => n + !isFuzzy(fScore[f]), 0);
    const top = cs.some((c) => cxScore[c] >= PREFIX - ALIAS) || fs.some((f) => fScore[f] >= PREFIX - ALIAS);
    if (top || good >= 3) { cs = cs.filter((c) => !isFuzzy(cxScore[c])); fs = fs.filter((f) => !isFuzzy(fScore[f])); }
    // rank: score, then busier hubs, then shorter names; lines: score, then the network's own order (JC = Chuo Rapid first)
    const hub = (c) => cxs[c].lines.length;
    cs.sort((a, b) => cxScore[b] - cxScore[a] || hub(b) - hub(a) || cxEntry[a].e.key.length - cxEntry[b].e.key.length || a - b);
    fs.sort((a, b) => fScore[b] - fScore[a] || fams[a].main - fams[b].main);
    const topS = cs.length ? cxScore[cs[0]] : 0;
    const topL = fs.length ? fScore[fs[0]] : 0;
    const lead = topL > topS ? 'lines' : 'stations';
    const nLines = lead === 'lines' ? limit : Math.max(3, Math.ceil(limit / 2));
    const stations = unique(cs.slice(0, limit).map((c) => {
      const { e, score } = cxEntry[c];
      return { ...complexRow(c, e.s, lang), score, how: e.text ? 'code' : HOW(score), code: e.text || null };
    }), lang);
    const lines = fs.slice(0, nLines).map((f) => ({ ...lineRow(f, lang), score: fScore[f], how: fEntry[f].text ? 'code' : HOW(fScore[f]) }));
    const first = lead === 'lines' ? (lines[0] ? { t: 'line', id: lines[0].id } : null) : stations[0] ? { t: 'station', id: stations[0].id } : null;
    return { q: raw, lead, first, stations, lines, ms: now() - t0 };
  }

  /**
   * The n complexes nearest to [lng, lat] (straight line), each at its nearest station.
   * @returns {Array<{c, g, s, id, name, other, lines, others, m, walkM, walkMin}>}
   */
  function near(x, y, n = 4, lang = 'en') {
    if (!Number.isFinite(+x) || !Number.isFinite(+y) || !C) return [];
    const RAD = Math.PI / 180;
    const R = 6371008;
    const kx = Math.cos(y * RAD) * R * RAD;
    const ky = R * RAD;
    const best = new Float64Array(C).fill(Infinity);
    const at = new Int32Array(C);
    for (let s = 0; s < N; s++) {
      const dx = (lng[s] - x) * kx;
      const dy = (lat[s] - y) * ky;
      const d = dx * dx + dy * dy;
      const c = cxOf[s];
      if (d < best[c]) { best[c] = d; at[c] = s; }
    }
    const top = [];
    for (let c = 0; c < C; c++) {
      if (!Number.isFinite(best[c])) continue;
      if (top.length < n) { top.push(c); top.sort((a, b) => best[a] - best[b]); continue; }
      if (best[c] < best[top[n - 1]]) { top[n - 1] = c; top.sort((a, b) => best[a] - best[b]); }
    }
    return unique(top.map((c) => {
      const m = Math.sqrt(best[c]);
      const walkM = m * 1.25;   // streets are not straight lines (trafik.live's walkMin factor)
      return { ...complexRow(c, at[c], lang), m: Math.round(m), walkM: Math.round(walkM), walkMin: Math.max(1, Math.round(walkM / 75)) };
    }), lang);
  }

  return {
    query, near,
    /** for page.js / tests: line, colour and code lookups the render helpers use */
    line: (i) => ln[i], lineCode, lineColor,
    stats: () => ({ stations: N, complexes: C, latin: LAT.length, cjk: CJK.length, ko: KO.length, codes: CODE.length, lines: fams.length }),
  };
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ================================================================== render (app/ui.js rows)
const STATION_SVG = '<svg class="i kr-sg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8.5 20l1.8-3.5M15.5 20l-1.8-3.5"/></svg>';
const stationTile = () => `<span class="etile kr-stile" aria-hidden="true">${STATION_SVG}</span>`;
/**
 * A line's round chip, types.js's lineChip() (one look on every screen: the code in a ring of the line colour, as
 * trafik.live/kereta). A line with no official number wears the Lines list's two letters (types.js).
 */
export const lineDisc = (search, i, lang = 'en', size = '') => {
  const L = search.line(i) || {};
  return lineChip({ ...L, code: search.lineCode(i) || ' ', color: search.lineColor(i) }, lang, size ? { size } : {});
};
/** Chips for a row's lines, the same code+colour once (JO Yokosuka / Sobu Rapid); over `max`, max-1 chips and "+n"
 * on the same line (Shinjuku: JY JC JB +8). */
function discs(search, lines, lang, max = 4) {
  const seen = new Set();
  const out = [];
  for (const i of lines) {
    const k = `${search.lineCode(i) || i}|${search.lineColor(i)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  const keep = out.length > max ? max - 1 : out.length;
  const shown = out.slice(0, keep).map((i) => lineDisc(search, i, lang, 'xs')).join('');
  const more = out.length > keep ? `<small class="srch-more">+${out.length - keep}</small>` : '';
  return `<span class="kr-buls">${shown}${more}</span>`;
}
const lineNames = (search, lines, lang) => [...new Set(lines.map((i) => nameIn(search.line(i)?.title, lang)).filter(Boolean))];

/** The other-script name (JA on EN/ID screens, EN on JA ones) in its own lang span (as the boards'
 * .tk-alt and page.js's rows): untagged kanji in an English page get Chinese glyph forms on an English iPhone and the
 * English voice in a screen reader. HTML; '' when there is none. */
export const otherSpan = (s, lang = 'en') => (s ? `<span lang="${lang === 'ja' ? 'en' : 'ja'}">${esc(s)}</span>` : '');
const joinSub = (parts) => parts.filter(Boolean).join(' · ');

function stationSub(r, t, lang) {
  const bits = [];
  if (r.code) bits.push(esc(r.code));
  if (r.other) bits.push(otherSpan(r.other, lang));
  if (r.others?.length) bits.push(esc(t('search.transfer', { names: r.others.slice(0, 2).join(', ') + (r.others.length > 2 ? ', …' : '') })));
  return joinSub(bits);
}
/** One station-complex row: data-station = the matched station's id, data-group = the complex (model.groups index).
 * sub = a plain-text second line instead of the default; subHtml = the same as HTML (caller escapes). */
export function stationRowHTML(search, r, { lang = 'en', t, sub = null, subHtml = null } = {}) {
  return row({
    attrs: `data-station="${esc(r.id)}" data-group="${r.g}"`,
    cls: 'kr-srow srch-row',
    lead: stationTile(),
    title: r.name,
    subHtml: subHtml ?? (sub != null ? esc(sub) : stationSub(r, t, lang)),
    right: { html: discs(search, r.lines, lang) },
    label: `${t('search.stationLabel', { name: r.name })}. ${lineNames(search, r.lines, lang).join(', ')}`,
  });
}
export function lineRowHTML(search, r, { lang = 'en', t } = {}) {
  return row({
    attrs: `data-line="${esc(r.id)}"`,
    cls: 'srch-row',
    lead: lineDisc(search, r.i, lang),
    title: r.name,
    subHtml: joinSub([esc(r.op), otherSpan(r.other, lang), esc(t('search.lineStations', { n: r.stations }))]),
    chev: true,
  });
}

/**
 * Results -> HTML (sections of rows; the leading kind first). Empty query -> ''. No hits -> an empty state.
 * opts: { lang, t(key, vars) } (t from tokyo/i18n.js).
 */
export function renderResults(search, res, { lang = 'en', t } = {}) {
  if (!res?.q) return '';
  const n = (k) => t('search.count', { n: k });
  const s = res.stations.length ? sec(t('search.stations'), n(res.stations.length), list(res.stations.map((r) => stationRowHTML(search, r, { lang, t })))) : '';
  const l = res.lines.length ? sec(t('search.lines'), n(res.lines.length), list(res.lines.map((r) => lineRowHTML(search, r, { lang, t })))) : '';
  if (!s && !l) return emptyState({ iconId: 'search', title: t('search.none', { q: res.q }), body: t('search.try'), compact: true });
  return res.lead === 'lines' ? l + s : s + l;
}

const distText = (m, lang) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', lang === 'id' ? ',' : '.')} km`);
/** "Stations near me" = the pill Home and kereta's Stations tab use (app .btn + kereta's .kr-locate + the locate glyph),
 * not a row with a lavender tile (lavender is for data only), with the state in a fine line under it. While
 * the position is being asked: dimmed (aria-busy) and inert (no data-search-near, so a second tap asks nothing). */
const nearPill = (t, note, busy = false) => `<button type="button" class="btn kr-locate" ${busy ? 'aria-busy="true" aria-disabled="true"' : 'data-search-near'}>${icon('locate')}${esc(t('search.nearBtn'))}</button>${note ? `<p class="fine">${esc(note)}</p>` : ''}`;

/** The "near me" block: the tap-to-ask pill, or the nearest complexes with walking distance, or why not. */
export function renderNear(search, state, { lang = 'en', t } = {}) {
  if (!state || state.st === 'idle') return sec(t('search.near'), '', nearPill(t, t('search.nearSub')));
  if (state.st === 'wait') return sec(t('search.near'), '', nearPill(t, t('search.nearWait'), true));
  if (state.st === 'denied' || state.st === 'fail') return sec(t('search.near'), '', nearPill(t, t(state.st === 'denied' ? 'search.nearDenied' : 'search.nearFail')));
  const items = state.list || [];
  if (!items.length || items[0].m > 30000) return sec(t('search.near'), '', `<p class="fine">${esc(t('search.nearFar'))}</p>`);
  const rows = items.map((r) => stationRowHTML(search, r, { lang, t, subHtml: joinSub([esc(t('search.walk', { min: r.walkMin, dist: distText(r.walkM, lang) })), otherSpan(r.other, lang)]) }));
  return sec(t('search.near'), t('search.nearSmall'), list(rows));
}

/** Extra CSS for the rows above (the rest is trafik.live's .row / .rtile.krl-bullet / .kr-buls / .kr-stile). */
export const SEARCH_CSS = '.srch-row .kr-buls{flex-wrap:nowrap;align-items:center;justify-content:flex-end}.srch-row .rr small.srch-more{font:600 13px/1 var(--font);color:var(--text2);margin-left:3px;font-variant-numeric:tabular-nums}';

// ================================================================== keyboard + mount (optional wiring for page.js)
/**
 * Arrow keys for a result list: ArrowDown in the field -> the first row (not while an IME is composing);
 * Up / Down / Home / End between rows (any .row in the container: handy on long lists); Escape, or Up from the first
 * row, -> back to the field ONLY from a search result (.srch-row) while the field has text. Anywhere else those keys
 * are left alone, so the page's Escape = Back works on every other screen. Enter / Space on
 * a row is the button's own click. Returns a function that removes the listeners.
 */
export function searchKeys(input, container) {
  if (!container) return () => {};
  const rows = () => [...container.querySelectorAll('button.row')].filter((r) => r.offsetParent !== null || !('offsetParent' in r));
  const onKey = (e) => {
    const list_ = rows();
    const i = list_.indexOf(document.activeElement);
    if (i < 0) return;
    const inResults = !!String(input?.value ?? '').trim() && !!list_[i].classList?.contains('srch-row');
    let to = -2;
    if (e.key === 'ArrowDown') to = Math.min(list_.length - 1, i + 1);
    else if (e.key === 'ArrowUp') to = i - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list_.length - 1;
    else if (e.key === 'Escape') to = -1;
    if (to === -2 || (to < 0 && !inResults)) return;   // not a result: Escape / Up at the top stay the page's
    e.preventDefault();
    if (to < 0) input?.focus();
    else list_[to].focus();
  };
  const onInputKey = (e) => {
    if (e.key !== 'ArrowDown' || e.isComposing) return;
    const r = rows()[0];
    if (r) { e.preventDefault(); r.focus(); }
  };
  container.addEventListener('keydown', onKey);
  input?.addEventListener('keydown', onInputKey);
  return () => { container.removeEventListener('keydown', onKey); input?.removeEventListener('keydown', onInputKey); };
}

/**
 * The search screen's body: results while typing, "near me" (asked on tap only) when the field is empty, arrow keys
 * between rows. Taps on rows are left to the page's own delegated handler (data-station / data-line), as on
 * trafik.live; this only handles its own near-me pill.
 *
 * @param el      container (the sheet / pane body)
 * @param ctx     { search, lang: () => 'en'|'ja'|'id', t, input?: HTMLInputElement, limit?, getLoc?: () => [lng, lat]|null,
 *                  onLoc?: ([lng, lat], accuracy) => void }
 * @returns {{ update(text), first(), rerender(), destroy() }}  (trafik.live's pane contract)
 */
export function mountSearch(el, ctx) {
  const { search, t } = ctx;
  const lang = () => (typeof ctx.lang === 'function' ? ctx.lang() : ctx.lang || 'en');
  let q = '';
  let res = null;
  let nearState = { st: 'idle', list: null };
  let dead = false;
  const render = () => {
    if (dead) return;
    if (!q.trim()) {
      res = null;
      const loc = ctx.getLoc?.();
      if (loc && nearState.st === 'idle') nearState = { st: 'ok', list: search.near(loc[0], loc[1], 4, lang()) };
      el.innerHTML = `${renderNear(search, nearState, { lang: lang(), t })}<p class="fine">${esc(t('search.try'))}</p>`;
      return;
    }
    res = search.query(q, lang(), ctx.limit || 8);
    el.innerHTML = renderResults(search, res, { lang: lang(), t });
  };
  const askNear = () => {
    if (!navigator.geolocation) { nearState = { st: 'fail' }; render(); return; }
    nearState = { st: 'wait' };
    render();
    navigator.geolocation.getCurrentPosition((p) => {
      if (dead) return;
      const at = [p.coords.longitude, p.coords.latitude];
      ctx.onLoc?.(at, p.coords.accuracy);
      nearState = { st: 'ok', list: search.near(at[0], at[1], 4, lang()) };
      render();
      el.querySelector('[data-station]')?.focus({ preventScroll: true });
    }, (err) => {
      if (dead) return;
      nearState = { st: err?.code === 1 ? 'denied' : 'fail' };
      render();
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  };
  const onClick = (e) => { if (e.target.closest?.('[data-search-near]')) { e.preventDefault(); askNear(); } };
  el.addEventListener('click', onClick);
  const unkeys = searchKeys(ctx.input, el);
  render();
  return {
    update(text) { q = String(text ?? ''); render(); },
    first: () => res?.first || null,
    rerender: render,
    destroy() {
      dead = true;
      el.removeEventListener('click', onClick);
      unkeys();
    },
  };
}
