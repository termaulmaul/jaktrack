// The route planner's state in the URL hash: #route=from:<stationId>;to:<stationId>;dep:0810  (or arr:0810).
// Only station ids travel in the link: "My location" is never written to it.
// The old one-ended links (#route=from:<id>, #route=to:<id>) parse the same way.
//
// export function routeHash({ from, to, mode, time }) -> 'from:..;to:..;dep:HHMM' | ''   (the id after "#route=")
// export function parseRouteHash(id) -> { from?, to?, mode?: 'dep' | 'arr', time?: 'HH:MM' }   ({} for anything broken)

const TIME = /^([01]\d|2[0-3]):?([0-5]\d)$/;

export function routeHash({ from, to, mode, time } = {}) {
  const ok = (v) => typeof v === 'string' && v && !/[;\s]/.test(v);
  const parts = [];
  if (ok(from)) parts.push(`from:${from}`);
  if (ok(to)) parts.push(`to:${to}`);
  const m = TIME.exec(time || '');
  if ((mode === 'dep' || mode === 'arr') && m) parts.push(`${mode}:${m[1]}${m[2]}`);
  return parts.join(';');
}

export function parseRouteHash(id) {
  const out = {};
  if (typeof id !== 'string' || id.length > 400) return out;
  for (const part of id.split(';')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const k = part.slice(0, i), v = part.slice(i + 1);
    if ((k === 'from' || k === 'to') && v && out[k] == null) out[k] = v;
    else if ((k === 'dep' || k === 'arr') && !out.mode) {
      const m = TIME.exec(v);
      if (m) { out.mode = k; out.time = `${m[1]}:${m[2]}`; }
    }
  }
  return out;
}
