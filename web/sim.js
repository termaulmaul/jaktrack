// Simulasi posisi bus dari jadwal GTFS berbasis frekuensi. Dipakai browser dan uji Node.

const R = 6371000, RAD = Math.PI / 180;
export const meters = (a, b, c, d) => {            // (lng1, lat1, lng2, lat2), cukup akurat untuk skala kota
  const x = (c - a) * RAD * Math.cos(((b + d) / 2) * RAD), y = (d - b) * RAD;
  return Math.hypot(x, y) * R;
};

// Bentuk rute disimpan sebagai selisih integer (derajat × 1e5): [lng0, lat0, dlng, dlat, ...]
export function decodeShape(d) {
  const n = d.length / 2, xy = new Float64Array(d.length), cum = new Float64Array(n);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    x += d[2 * i]; y += d[2 * i + 1];
    xy[2 * i] = x / 1e5; xy[2 * i + 1] = y / 1e5;
    if (i) cum[i] = cum[i - 1] + meters(xy[2 * i - 2], xy[2 * i - 1], xy[2 * i], xy[2 * i + 1]);
  }
  return { xy, cum };
}

// Indeks terbesar i dengan arr[i] <= v (arr menaik)
function floorIndex(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid - 1; }
  return lo;
}

export function pointAt({ xy, cum }, dist) {
  const i = Math.min(floorIndex(cum, dist), cum.length - 2);
  const span = cum[i + 1] - cum[i], f = span ? Math.min(1, Math.max(0, (dist - cum[i]) / span)) : 0;
  return [xy[2 * i] + (xy[2 * i + 2] - xy[2 * i]) * f, xy[2 * i + 1] + (xy[2 * i + 3] - xy[2 * i + 1]) * f];
}

// Jarak sepanjang rute pada detik ke-`el` sejak berangkat; st = detik tiba per halte, sd = meter per halte
export function distAt(trip, el) {
  const { st, sd } = trip, i = Math.min(floorIndex(st, el), st.length - 2);
  const span = st[i + 1] - st[i], f = span ? Math.min(1, Math.max(0, (el - st[i]) / span)) : 0;
  return sd[i] + (sd[i + 1] - sd[i]) * f;
}

export function prepare(pack) {
  return pack.trips.map(t => ({ ...t, shape: decodeShape(t.p), dur: t.st[t.st.length - 1] }));
}

// Layanan GTFS yang aktif pada satu hari; day: 0 = Senin ... 6 = Minggu
export const activeServices = (calendar, day) =>
  new Set(Object.keys(calendar).filter(id => calendar[id][day]));

// Semua bus yang sedang jalan pada detik `sec` sejak 00.00 WIB. `yesterday` menangkap bus yang berangkat sebelum tengah malam.
export function busesAt(trips, sec, today, yesterday = new Set()) {
  const out = [];
  for (const trip of trips) {
    const passes = [[sec, today]];
    if (sec < trip.dur) passes.push([sec + 86400, yesterday]);
    for (const [t, services] of passes) {
      if (!services.has(trip.sv)) continue;
      for (const [start, end, headway] of trip.f) {
        if (t < start || headway <= 0) continue;
        // keberangkatan: start, start+headway, ... selama < end; ambil yang masih di jalan (berangkat > t - dur)
        const last = Math.min(Math.floor((t - start) / headway), Math.ceil((end - start) / headway) - 1);
        for (let k = last; k >= 0; k--) {
          const el = t - (start + k * headway);
          if (el > trip.dur) break;
          const [lng, lat] = pointAt(trip.shape, distAt(trip, el));
          out.push({ lng, lat, trip });
        }
      }
    }
  }
  return out;
}

// Jam dan hari di Jakarta (UTC+7, tanpa DST) dari epoch ms
export function jakartaClock(ms) {
  const d = new Date(ms + 7 * 3600e3);
  const sec = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
  const day = (d.getUTCDay() + 6) % 7;
  return { sec, day, yesterday: (day + 6) % 7 };
}
