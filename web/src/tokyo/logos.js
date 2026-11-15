// Operator logos from Wikimedia Commons (web/public/logos/; source, owner and licence status per file in SUMBER.md).
// They only mark which operator runs a line or a bus, never jaktrack itself, and the operator's name is always
// written next to them. The trademarks stay their owners'.
import { esc } from '../app/format.js';

/** Network / bus operator id -> file name in web/public/logos/ (without .svg). */
export const LOGOS = {
  'KAI-Commuter': 'kai-commuter',
  KAI: 'kai',
  'MRT-Jakarta': 'mrt-jakarta',
  'LRT-Jakarta': 'lrt-jakarta',
  'LRT-Jabodebek': 'lrt-jabodebek',
  TransJakarta: 'transjakarta',
};

/** '/logos/<file>.svg' for an operator id, or null when it has none (the caller keeps its initials). */
export const logoUrl = (op) => (Object.hasOwn(LOGOS, op) ? `/logos/${LOGOS[op]}.svg` : null);

/**
 * The operator's logo on a white plate (the logos are drawn for a white ground), or '' when it has none.
 * aria-hidden: the name written beside it is what a screen reader reads; alt (the name) shows if the file fails.
 * size: 'row' = 64 x 40 at the head of a list row (wide wordmarks need more than the old 40 px disc), 'sm' = 52 x 28
 * (a chip's height) inside a heading or a chip row.
 */
export function logoPlate(op, name, size = 'row') {
  const src = logoUrl(op);
  return src ? `<span class="tk-logo tk-logo-${size}" data-op="${esc(op)}" aria-hidden="true"><img src="${src}" alt="${esc(name || op)}" decoding="async"></span>` : '';
}
