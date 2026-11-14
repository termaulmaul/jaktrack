// How many tracks run side by side along each line, and which of them a train uses: the heights pack's `tracks` and
// `hand` (data-build/elev.mjs from OpenStreetMap's parallel railway ways; docs/REL.md).
//   pack.tracks = { lineId: [[fromM, toM, tracks, halfM], ...] }   halfM = half the spacing of the two tracks either side
//                                                                    of the line's path (0 on single track)
//   pack.hand   = { lineId: 1 | -1 | 0 }                            1 = trains keep right, -1 = keep left, 0 = unknown
// Without the pack every lookup says "unknown" and the callers keep what they did before.
//
// export function railsOf(net, pack) -> { has(li), half(li, m), hand(li), offset(li, m) }

// Jarak sumbu dua rel paling sedikit 4 m (setengahnya 2 m): badan kereta 2,95 m, jadi dengan jarak hasil ukur OSM yang
// kadang hanya 3 m dua kereta berpapasan tampak bersentuhan atau bertumpuk. Nilai ukur yang lebih lebar tetap dipakai.
export const MIN_HALF_M = 2;
const BLEND_M = 40;   // a train moves from two tracks onto one (and back) over this many metres either side of the change

export function railsOf(net, pack) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const R = lines.map((l) => {
    const r = pack?.tracks?.[l.id];
    return Array.isArray(r) && r.length ? r : null;
  });
  const H = lines.map((l) => { const h = pack?.hand?.[l.id]; return h === 1 || h === -1 ? h : 0; });
  const last = new Int32Array(lines.length);   // the range the last lookup of a line landed in (trains move slowly)
  const raw = (li, m) => {
    const r = R[li];
    if (!r) return 0;
    let i = last[li] < r.length ? last[li] : 0;
    if (!(m >= r[i][0] && m < r[i][1])) {
      let lo = 0, hi = r.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (r[mid][1] <= m) lo = mid + 1; else hi = mid; }
      i = lo; last[li] = i;
    }
    return r[i][2] >= 2 ? Math.max(r[i][3], MIN_HALF_M) : 0;
  };
  /** Half the track spacing at m metres along line li (0 = single track or unknown), eased where it changes. */
  const half = (li, m) => (R[li] ? (raw(li, m - BLEND_M) + 2 * raw(li, m) + raw(li, m + BLEND_M)) / 4 : 0);
  return {
    /** The pack knows this line's tracks. */
    has: (li) => !!R[li],
    half,
    hand: (li) => H[li] || 0,
    /** Metres LEFT of its own direction of travel where a train runs at m (either way along the line): negative = right
     * (keep right), 0 on single track, where the pack has no data, or where the side is unknown. */
    offset: (li, m) => -H[li] * half(li, m) || 0,
  };
}
