// Indonesian formatting for the shell: thousands with a dot, short time words ("2 dtk lalu", "3 mnt"), WIB clock.

const nf = new Intl.NumberFormat('id-ID');
export const fmtInt = (n) => nf.format(Math.round(n));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** ETA in minutes -> {text, html, cls}. null/undefined -> "–", <= 0 -> "Tiba". */
export function eta(min) {
  if (min == null || !Number.isFinite(min)) return { text: '–', html: '–', cls: 'none' };
  const m = Math.round(min);
  if (m <= 0) return { text: 'Tiba', html: 'Tiba', cls: 'now' };
  if (m < 60) return { text: `${m} mnt`, html: `${m}<small>mnt</small>`, cls: '' };
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? { text: `${h} j ${r} mnt`, html: `${h}<small>j</small> ${r}<small>mnt</small>`, cls: '' } : { text: `${h} jam`, html: `${h}<small>jam</small>`, cls: '' };
}

/** Minutes -> "3 mnt", "1 j 5 mnt"; <= 0 -> "Tiba"; unknown -> "–". */
export function minText(min) {
  if (min == null || !Number.isFinite(min)) return '–';
  const m = Math.round(min);
  if (m <= 0) return 'Tiba';
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} j ${r} mnt` : `${h} jam`;
}

/** Age in ms -> "2 dtk", "3 mnt", "1 jam" (the stats card's "diperbarui"). */
export function ageShort(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${Math.max(1, s)} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt`;
  return `${Math.floor(m / 60)} jam`;
}

/** Age in ms -> "2 dtk lalu". */
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return 'baru saja';
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} jam lalu` : `${Math.floor(h / 24)} hari lalu`;
}

export function dist(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
}

/** Walking minutes at ~75 m/min with a 1.25 detour factor (streets are not straight lines). */
export const walkMin = (m) => Math.max(1, Math.round((m * 1.25) / 75));

/** Minute of day (may exceed 1440) -> "05.30". */
export function clock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`;
}

/** Current minute of day in WIB (UTC+7, no DST). */
export const wibMinute = (t = Date.now()) => Math.floor((t / 60000 + 420) % 1440);

/** Relative luminance check for badges with light route colours. */
export function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.82;
}

export const RAD = Math.PI / 180;
/** Metres between two [lng, lat] points (equirectangular is plenty inside one city). */
export function metres(a, b) {
  const x = (b[0] - a[0]) * RAD * Math.cos(((a[1] + b[1]) / 2) * RAD);
  const y = (b[1] - a[1]) * RAD;
  return Math.sqrt(x * x + y * y) * 6371008;
}
