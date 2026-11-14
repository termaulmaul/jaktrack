// Markup helpers shared by the panes: tiles, inset-grouped rows, stats card, empty state, badges. Strings in, strings out; every dynamic value goes through esc().

import { esc, isLight } from './format.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const icon = (id, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

/** Route tile: the route code on the route colour, as a disc. size: '' (40) | 'xl' (56) | 'md' (36) | 'sm' (32). */
export function rtile(route, size = '', fallbackCode = '') {
  const code = String(route ? route.short || route.id : fallbackCode || '?');
  const bg = route?.color || '#6B6B70';
  const fg = route?.text || '#FFFFFF';
  const m = /^([A-Za-z]{2,4})\.(.+)$/.exec(code);   // "JAK.10A" -> JAK over 10A
  const main = m ? m[2] : code;
  const light = isLight(bg) ? ' data-light' : '';
  const inner = m ? `<span class="pre">${esc(m[1])}</span><span class="cd">${esc(main)}</span>` : esc(main);
  return `<span class="rtile${size ? ` ${size}` : ''}" style="--rc:${esc(bg)};--rt:${esc(fg)}" data-len="${Math.min(7, main.length)}"${light} aria-hidden="true">${inner}</span>`;
}

export const etile = (emoji, cls = '') => `<span class="etile${cls ? ` ${cls}` : ''}" aria-hidden="true">${emoji}</span>`;
export const itile = (id, { tint, color } = {}) => `<span class="itile" style="${tint ? `--tc:${tint};` : ''}${color ? `--ic:${color};` : ''}" aria-hidden="true">${icon(id)}</span>`;

/** A kind's dot (colour from the routes of that kind). */
export function kdot(st, kind) {
  const c = st?.kindColor?.[kind] || { css: '#A1A1A6', light: false };
  return `<i class="kdot" style="--kc:${c.css}"${c.light ? ' data-light' : ''} aria-hidden="true"></i>`;
}

/** A little pie of these routes' colours (the camera corridors' chip and switch). */
export function routesDot(st, ids) {
  const cols = (ids || []).map((id) => st?.routeById.get(id)?.color).filter(Boolean);
  if (!cols.length) return kdot(st, 'brt');
  const step = 100 / cols.length;
  const css = cols.length === 1 ? cols[0] : `conic-gradient(${cols.map((c, i) => `${c} ${(i * step).toFixed(1)}% ${((i + 1) * step).toFixed(1)}%`).join(', ')})`;
  return `<i class="kdot" style="--kc:${css}" aria-hidden="true"></i>`;
}

/** "1, 4, dan 9" */
export const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')}, dan ${xs[xs.length - 1]}` : xs.join(''));

export const badge = (label, cls = '') => `<span class="badge${cls ? ` ${cls}` : ''}">${esc(label)}</span>`;

/**
 * An inset-grouped row. `attrs` is raw (data-route="…" etc., already escaped). Without attrs the row is a div.
 * right: {b?: string, small?: string, big?: string, bigCls?: string, html?: string} (strings are escaped).
 */
export function row({ attrs = '', lead = '', title = '', titleHtml = '', sub = '', subHtml = '', right = null, chev = false, cls = '', label = '' }) {
  const tag = attrs ? 'button' : 'div';
  const r = right
    ? `<span class="rr">${right.html || ''}${right.big != null ? `<span class="big${right.bigCls ? ` ${right.bigCls}` : ''}">${esc(right.big)}</span>` : ''}${right.b != null ? `<b>${esc(right.b)}</b>` : ''}${right.small != null ? `<small>${esc(right.small)}</small>` : ''}</span>`
    : '';
  return `<${tag} ${tag === 'button' ? 'type="button" ' : ''}class="row${cls ? ` ${cls}` : ''}" ${attrs}${label ? ` aria-label="${esc(label)}"` : ''}>
    ${lead}<span class="rt"><b>${titleHtml || esc(title)}</b>${subHtml ? `<span>${subHtml}</span>` : sub ? `<span>${esc(sub)}</span>` : ''}</span>${r}${chev ? icon('chev', 'chev') : ''}
  </${tag}>`;
}

export const list = (rows) => `<div class="list">${rows.join('')}</div>`;

export function sec(title, small, body, { live = false, id = '' } = {}) {
  const sm = live ? `<small class="live"><i class="livedot"></i>${esc(small || UI_TEXT.live)}</small>` : small ? `<small>${esc(small)}</small>` : '';
  return `<section class="sec"${id ? ` id="${id}"` : ''}><div class="sech"><h2>${esc(title)}</h2>${sm}</div>${body}</section>`;
}

/** Stats card: [{value, label, attrs?}] -> 3 columns with hairlines. value null = skeleton. */
export function stats(items) {
  return `<div class="stats">${items.map((s) => `<div class="stat">${s.value == null ? '<b class="sk"></b>' : `<b ${s.attrs || ''}>${esc(s.value)}</b>`}<span>${esc(s.label)}</span></div>`).join('')}</div>`;
}

export function skeletonRows(n = 3) {
  return `<div class="list" aria-hidden="true">${Array.from({ length: n }, () => '<div class="skrow"><span class="sk a"></span><span class="b"><span class="sk sk-t" style="width:62%"></span><span class="sk sk-t" style="width:38%"></span></span><span class="sk c"></span></div>').join('')}</div>`;
}

/** EmptyState: an icon tile, a headline, a caption, an optional button. */
export function emptyState({ iconId = '', title, body = '', action = '', actionAttrs = '', actionIcon = '', compact = false, card = false }) {
  const art = iconId ? `<span class="eic">${icon(iconId)}</span>` : '';
  const btn = action ? `<button type="button" class="btn primary" ${actionAttrs}>${actionIcon ? icon(actionIcon) : ''}${esc(action)}</button>` : '';
  return `<div class="empty${compact ? ' compact' : ''}${card ? ' card' : ''}">${art}<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}${btn}</div>`;
}

/** Words the helpers write themselves; a page in another language sets them (Tokyo: page.js from i18n.js). */
const UI_TEXT = { close: 'Tutup', live: 'Langsung' };
export function setUiText(words) { Object.assign(UI_TEXT, words || {}); }

/** Place-page head: tile, title (2 lines), sub, and the close button (desktop; the phone has the top bar's back). */
export function placeHead({ lead, title, titleHtml = '', sub = '', close = true }) {
  return `<div class="ph" data-drag>${lead}<div class="rt"><h2>${titleHtml || esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${close ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(UI_TEXT.close)}">${icon('x')}</button>` : ''}</div>`;
}

/** Live dot colour by report age. */
export function freshClass(ageMs) {
  if (ageMs < 45000) return '';
  if (ageMs < 120000) return 'old';
  return 'stale';
}

let toastTimer = 0;
/** A short message. opts.action + opts.onAction add one button (e.g. Undo); it stays 6 s. */
export function toast(msg, opts = {}) {
  const el = $('#toast');
  if (!el) return;
  const act = opts.action && typeof opts.onAction === 'function';
  if (act) {
    el.innerHTML = `<span>${esc(msg)}</span><button type="button" class="tact">${esc(opts.action)}</button>`;
    el.querySelector('.tact').addEventListener('click', () => { clearTimeout(toastTimer); el.hidden = true; opts.onAction(); }, { once: true });
  } else el.textContent = msg;
  el.classList.toggle('has-act', !!act);
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, act ? 6000 : Math.min(4000, 1500 + msg.length * 40));
}
