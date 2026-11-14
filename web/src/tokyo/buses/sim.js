// Simulasi bus dari jadwal GTFS berbasis frekuensi (port dari purwarupa, commit e2ae3e6: web/sim.js). Tiap pola trip
// punya waktu antar-halte (st) dan jendela frekuensi (f = [mulai, selesai, headway] detik); satu bus berangkat tiap
// headway. Ini BUKAN posisi langsung. Dipakai index.js (browser), data-build/bus.mjs, dan uji.

const DAY = 86400, SWITCH = 3 * 3600;

/**
 * Hari layanan berganti 03.00 WIB: keberangkatan sebelum 03.00 milik hari layanan sebelumnya, jadi digeser +24 jam
 * (jenis hari Sabtu berlaku sampai Minggu 02.59). Jarak antar-keberangkatan dalam satu jendela tidak berubah.
 */
export function serviceWindows(f) {
  return f.flatMap(([start, end, headway]) => {
    if (start >= SWITCH || headway <= 0) return [[start, end, headway]];
    const late = start + Math.ceil((SWITCH - start) / headway) * headway;   // keberangkatan pertama pada/sesudah 03.00
    return [[start + DAY, Math.min(end, SWITCH) + DAY, headway], ...(late < end ? [[late, end, headway]] : [])];
  });
}

/** Layanan GTFS yang aktif pada satu hari; day: 0 = Senin ... 6 = Minggu. */
export const activeServices = (calendar, day) => new Set(Object.keys(calendar).filter((id) => calendar[id][day]));

/**
 * Semua bus yang sedang jalan pada detik `sec` sejak 00.00 WIB: [{ trip, el }], el = detik sejak berangkat.
 * trip: { sv, f, dur }. `yesterday` menangkap bus yang berangkat kemarin (lewat tengah malam, atau jendela +24 jam).
 */
export function busesAt(trips, sec, today, yesterday = new Set()) {
  const out = [];
  for (const trip of trips) {
    for (const [t, services] of [[sec, today], [sec + DAY, yesterday]]) {
      if (!services.has(trip.sv)) continue;
      for (const [start, end, headway] of trip.f) {
        if (t < start || headway <= 0) continue;
        // keberangkatan: start, start+headway, ... selama < end; ambil yang masih di jalan (berangkat > t - dur)
        const last = Math.min(Math.floor((t - start) / headway), Math.ceil((end - start) / headway) - 1);
        for (let k = last; k >= 0; k--) {
          const el = t - (start + k * headway);
          if (el > trip.dur) break;
          out.push({ trip, el });
        }
      }
    }
  }
  return out;
}

/** Jam dan hari di Jakarta (UTC+7, tanpa DST) dari epoch ms. */
export function jakartaClock(ms) {
  const d = new Date(ms + 7 * 3600e3);
  const sec = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
  const day = (d.getUTCDay() + 6) % 7;
  return { sec, day, yesterday: (day + 6) % 7 };
}

/** Dua lintasan waktu yang dipakai busesAt: [detik, hari] hari ini dan kemarin (+24 jam), hanya yang layanannya aktif. */
const passes = (trip, calendar, ms) => {
  const c = jakartaClock(ms);
  return [[c.sec, c.day], [c.sec + DAY, c.yesterday]].filter(([, day]) => calendar[trip.sv]?.[day]).map(([t]) => t);
};

/** Headway (detik) pola ini pada waktu `ms`: jendela frekuensi yang sedang terbuka, atau null bila tidak ada. */
export function headwayNow(trip, calendar, ms) {
  let best = null;
  for (const t of passes(trip, calendar, ms)) for (const [start, end, headway] of trip.f) {
    if (headway > 0 && t >= start && t < end && (best == null || headway < best)) best = headway;
  }
  return best;
}

/** Detik sampai bus berikutnya dari pola ini tiba di halte ke-j (st[j] detik setelah berangkat), atau null. Perkiraan dari jadwal. */
export function nextArrival(trip, j, calendar, ms) {
  let best = null;
  for (const t of passes(trip, calendar, ms)) for (const [start, end, headway] of trip.f) {
    if (headway <= 0) continue;
    const dep = start + Math.max(0, Math.ceil((t - trip.st[j] - start) / headway)) * headway;   // keberangkatan pertama yang belum lewat halte ini
    if (dep < end && (best == null || dep + trip.st[j] - t < best)) best = dep + trip.st[j] - t;
  }
  return best;
}

/** Trip siap simulasi dari bagian `sim` berkas bus: [[id, indeks rute, layanan, st, f]], sejajar dengan pack.pats. */
export const simTrips = (pack) => pack.sim.trips.map(([id, r, sv, st, f], i) => (
  { id, route: pack.routes[r].id, sv, st, along: pack.pats[i].along, f: serviceWindows(f), dur: st[st.length - 1] }));

/** Bus yang jalan pada waktu `ms` (epoch). */
export function busesNow(trips, calendar, ms) {
  const c = jakartaClock(ms);
  return busesAt(trips, c.sec, activeServices(calendar, c.day), activeServices(calendar, c.yesterday));
}
