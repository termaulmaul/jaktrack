/*! Portions from Mini Tokyo 3D, (c) 2019-2026 Akihiko Kusanagi, MIT License: see /LICENSES.txt */
// which timetable runs on a given day in Tokyo.
//
// Same rule as Mini Tokyo 3D's Clock.getCalendar() + loader (MIT, (c) Akihiko Kusanagi), ported:
//   - the service day turns over at 03:00 WIB (00:00-02:59 belongs to the previous day);
//   - 'Holiday' = Sunday, a Japanese public holiday (incl. substitute 振替休日 and citizens' 国民の休日), or
//     30 Dec - 3 Jan; 'Saturday' = other Saturdays; else 'Weekday';
//   - MT3D then loads the shared Saturday/holiday set plus the day's own rare set. Our calendar names (= MT3D's build
//     file names): weekday (Weekday), holiday (SaturdayHoliday), saturday (Saturday), sunday-holiday (Holiday).
//     calendarFor() returns them in preference order; tt.js loadRuns gives each line the first one it has.
// Holidays 2026-2027: Cabinet Office 内閣府「国民の祝日」CSV (https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv),
// fetched 3 Nov 2026; '休日' rows are substitute or citizens' holidays. Outside 2026-2027 only Sundays and
// 30 Dec - 3 Jan count as holidays (holidayKnown() tells): extend HOLIDAYS from the CSV before 2028.

const WIB = 7 * 3600e3;
const TURNOVER = 3 * 3600e3;

// shortcut: hari libur nasional Indonesia belum dimasukkan (hanya Sabtu/Minggu yang memakai jadwal akhir pekan);
// isi HOLIDAYS dari SKB libur nasional bila papan jadwal hari libur perlu tepat.
export const HOLIDAY_YEARS = [];
const NAMES = {};
/** 'YYYY-MM-DD' -> nama hari libur. */
export const HOLIDAYS = {};

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Normalise 'YYYY-MM-DD' | Date | ms (-> its service date) to { y, m, d, date: 'YYYY-MM-DD' }. */
function parts(dateJST) {
  if (typeof dateJST === 'number' || dateJST instanceof Date) dateJST = serviceDate(+dateJST);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateJST));
  if (!m) throw new Error(`calendar: expected YYYY-MM-DD, got ${dateJST}`);
  return { y: +m[1], m: +m[2], d: +m[3], date: m[0] };
}

/** WIB service date 'YYYY-MM-DD' for an instant (ms since epoch): 00:00-02:59 WIB counts as the previous day. */
export function serviceDate(ms = Date.now()) {
  const t = new Date(ms + WIB - TURNOVER);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** ms since epoch of 00:00 WIB on a 'YYYY-MM-DD' date (the zero of that service day's timetable seconds). */
export function dayStartMs(dateJST) {
  const { y, m, d } = parts(dateJST);
  return Date.UTC(y, m - 1, d) - WIB;
}

/** Seconds since 00:00 WIB of the service day for an instant: 01:30 WIB on 4 Nov -> 91800 of 3 Nov. */
export function serviceSec(ms = Date.now()) {
  return (ms - dayStartMs(serviceDate(ms))) / 1000;
}

/** Inverse of serviceSec: ms since epoch for `sec` of the service day `dateJST`. */
export function msAt(dateJST, sec) {
  return dayStartMs(dateJST) + sec * 1000;
}

/** Day of week of a 'YYYY-MM-DD' date, 0 = Sunday. */
export function dayOfWeek(dateJST) {
  const { y, m, d } = parts(dateJST);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** true when the holiday table covers the date's year. */
export function holidayKnown(dateJST) {
  return HOLIDAY_YEARS.includes(parts(dateJST).y);
}

/** Public holiday on that date: { ja, en } or null. Substitute / citizens' holidays are '休日'. */
export function holidayOf(dateJST) {
  const ja = HOLIDAYS[parts(dateJST).date];
  return ja ? { ja, en: NAMES[ja] || ja } : null;
}

/** MT3D's day kind: 'Holiday' (Sunday, public holiday, 30 Dec - 3 Jan), 'Saturday' or 'Weekday'. */
export function dayKind(dateJST) {
  const p = parts(dateJST);
  const dow = dayOfWeek(p.date);
  if (dow === 0 || HOLIDAYS[p.date]) return 'Holiday';
  if (dow === 6) return 'Saturday';
  return 'Weekday';
}

/** Timetable calendars for a date, in preference order per line (pass to tt.js loadRuns({ cal })). */
export function calendarFor(dateJST) {
  const kind = dayKind(dateJST);
  if (kind === 'Holiday') return ['sunday-holiday', 'holiday'];
  if (kind === 'Saturday') return ['saturday', 'holiday'];
  return ['weekday'];
}

/** MT3D's main timetable for a date (its getTimetableFileName): 'weekday', or 'holiday' (the shared
 *  Saturday/Sunday/holiday set) on Saturdays and holidays. Signature fits model.js's setCalendar(fn(dateISO, weekday)). */
export function calendarOf(dateJST) {
  return dayKind(dateJST) === 'Weekday' ? 'weekday' : 'holiday';
}

/** Everything for one instant: { date, sec, kind, cals, holiday, known }. */
export function calendarAt(ms = Date.now()) {
  const date = serviceDate(ms);
  return { date, sec: serviceSec(ms), kind: dayKind(date), cals: calendarFor(date), holiday: holidayOf(date), known: holidayKnown(date) };
}
