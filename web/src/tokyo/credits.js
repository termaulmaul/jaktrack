// Credits, the data notice and the map attribution. Full notices: /LICENSES.txt (web/public), NOTICE.md in the repo.
//
//   import { credits, attribution, attributionShort, attributionHtml, footer, creditsHtml } from './credits.js'
//   credits.en | .ja | .id  -> [{ key, head, lines: [text...], links: [{ href, label }] }]  About > Data and credits
//   creditsHtml(ctx)        -> the same blocks as HTML; page.js's About calls it with ctx.lang / ctx.esc / ctx.model
//                              (live Toei on = ctx.live or window.__tokyo.live state 'on': credit names the live sets)
//   toeiCredit(lang, live)  -> the Toei CC BY 4.0 credit text (ODPT FAQ format)
//   toeiBusCredit(lang)     -> the Toei Bus CC BY 4.0 credit (bus GTFS + GTFS-RT; block 'toeiBus')
//   attribution             -> the map credit, full form (basemap-dependent: config.js BASEMAP)
//   attributionShort        -> '© OpenStreetMap'  (the collapsed pill: OSM's guideline accepts it)
//   attributionHtml         -> the full form with its links
//   footer.en | .ja | .id   -> one-line footer credit
//   launchBlockers()        -> what must be set before a public deployment ([] = nothing)
//
// Rules this file keeps:
// - The ODPT notice is verbatim in JA and EN from 公共交通オープンデータ開発者ガイドライン 3.1 (the official example,
//   including its "this app, etc."). ID has no official text: ours, labelled as a translation.
// - 取得日時 (guideline 2.2.1): the date the timetable data was obtained is shown in About (the data pack's
//   meta.source.obtained = the day `npm run data` downloaded it).
// - An inquiry address (guideline 3.1 (3)): CONTACT (config.js; TOKYO_CONTACT at build time).
// - Toei data is CC BY 4.0: credit in the format of ODPT's FAQ, saying we modified it.
// - OpenStreetMap: "© OpenStreetMap" stays visible on the map, linked to openstreetmap.org/copyright; the basemap's own
//   credit (OpenFreeMap / OpenMapTiles, or Protomaps for self-hosted tiles) in About.
// - Name no live source beyond what the licences require.
import { BASEMAP, CONTACT as CONFIG_CONTACT } from './config.js';
import { APP_NAME } from '../project.js';

const LANGS = ['en', 'ja', 'id'];

/** The address for questions about this app (ODPT guideline 3.1 (3)). Empty = About shows a placeholder. */
export const CONTACT = CONFIG_CONTACT;
/** Fallbacks when the data pack carries no meta.source: the pinned Mini Tokyo 3D snapshot (data-build/paths.mjs). */
export const DATA_OBTAINED = null;
export const SNAPSHOT = { name: 'Mini Tokyo 3D', ref: 'fa7833f', date: '2026-11-02' };

export const URLS = {
  odpt: 'https://www.odpt.org/',
  odptTerms: 'https://developer.odpt.org/terms',
  mt3d: 'https://github.com/nagix/mini-tokyo-3d',
  osm: 'https://www.openstreetmap.org/copyright',
  odbl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  protomaps: 'https://protomaps.com',
  openfreemap: 'https://openfreemap.org',
  openmaptiles: 'https://www.openmaptiles.org/',
  maplibre: 'https://maplibre.org',
  ccby: {
    en: 'https://creativecommons.org/licenses/by/4.0/deed.en',
    ja: 'https://creativecommons.org/licenses/by/4.0/deed.ja',
    id: 'https://creativecommons.org/licenses/by/4.0/deed.id',
  },
  licenses: '/LICENSES.txt',
};

// ------------------------------------------------------------------ the ODPT notice (verbatim JA / EN)
export const ODPT_NOTICE = {
  ja: [
    '本アプリケーションが利用する公共交通データは、公共交通オープンデータセンターにおいて提供されるものです。',
    '公共交通事業者により提供されたデータを元にしていますが、必ずしも正確・完全なものとは限りません。本アプリケーションの表示内容について、公共交通事業者への直接の問合せは行わないでください。',
    '本アプリケーションに関するお問い合わせは、以下のメールアドレスにお願いします。',
  ],
  en: [
    'The source of the public transportation data in this app, etc. is the Public Transportation Open Data Center.',
    'They are based on the data provided by the public transportation operators. The accuracy and integrity of the data are not guaranteed. Please do not contact the public transportation operators directly regarding the content of the app.',
    'For inquiries on the app, please contact the following e-mail address.',
  ],
  id: [
    'Data transportasi umum di aplikasi ini berasal dari Public Transportation Open Data Center (公共交通オープンデータセンター).',
    'Data ini dibuat dari data operator transportasi umum, tetapi belum tentu akurat dan lengkap. Jangan menghubungi operator transportasi umum secara langsung tentang isi aplikasi ini.',
    'Untuk pertanyaan tentang aplikasi ini, hubungi alamat email berikut.',
  ],
};
const CONTACT_PENDING = {
  en: '(no contact address set: TOKYO_CONTACT)',
  ja: '（連絡先が未設定です: TOKYO_CONTACT）',
  id: '(alamat kontak belum diatur: TOKYO_CONTACT)',
};

// ------------------------------------------------------------------ dates
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
};
/** '2026-11-03' -> '3 Nov 2026' | '2026年11月3日' | '3 November 2026' (no Intl: same text everywhere). */
export function fmtDate(iso, lang = 'en') {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (lang === 'ja') return `${y}年${mo}月${d}日`;
  return `${d} ${(MONTHS[lang] || MONTHS.en)[mo - 1]} ${y}`;
}

// ------------------------------------------------------------------ the blocks, per language
// Toei datasets (ckan.odpt.org, all CC BY 4.0; titles as the catalogue gives them): r_train_timetable-toei,
// r_station-toei, r_route-toei; while live Toei data is in use also r_train_location-toei and r_train_status-toei.
// Credit format: ODPT FAQ (https://developer.odpt.org/en/faq-info#cc-by-credit).
const TOEI_SETS = {
  en: ['Train timetable', 'Station information', 'Route information'],
  ja: ['列車時刻表', '駅情報', '路線系統情報'],
};
const TOEI_LIVE_SETS = {
  en: ['Train location information', 'Train status information'],
  ja: ['列車ロケーション情報', '運行情報'],
};
// Toei Bus: ckan.odpt.org b_bus_gtfs_jp-toei (バス関連情報 / Bus information, GTFS-JP) and b_bus_gtfs_rt-toei
// (バス関連リアルタイム情報 / Bus realtime information, GTFS-RT positions), both CC BY 4.0, same provider. Credited
// whenever the bus data is built (npm run data:bus) or live buses run.
const TOEI_BUS_SETS = {
  en: ['Bus information', 'Bus realtime information'],
  ja: ['バス関連情報', 'バス関連リアルタイム情報'],
};
/** When the bus GTFS was obtained (ODPT guideline 2.2.1): the bus pack's own date when the page passes it. */
export const BUS_OBTAINED = null;
const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a.join(''));
/** One Toei CC BY 4.0 credit in the ODPT FAQ format, naming these datasets (EN titles, JA titles). */
function toeiFormat(lang, enSets, jaSets) {
  const en = andList(enSets);
  const ja = jaSets.join('・');
  const by = 'Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation';
  const of = 'of Bureau of Transportation, Tokyo Metropolitan Government';
  if (lang === 'ja') return `このアプリは、以下の著作物を改変して利用しています。 東京都交通局・公共交通オープンデータ協議会、東京都交通局 ${ja}、クリエイティブ・コモンズ・ライセンス　表示4.0国際（${URLS.ccby.ja}）`;
  if (lang === 'id') return `Aplikasi ini memakai karya berhak cipta berikut dengan perubahan. ${by}, ${en} ${of}, Creative Commons Atribusi 4.0 Internasional (${URLS.ccby.id})`;
  return `This app uses the following copyrighted material with modifications. ${by}, ${en} ${of}, Creative Commons License Attribution 4.0 International (${URLS.ccby.en})`;
}
/** The Toei CC BY 4.0 credit; `live` = also name the live datasets (positions + status) the page uses now. */
export function toeiCredit(lang = 'en', live = false) {
  return toeiFormat(lang, [...TOEI_SETS.en, ...(live ? TOEI_LIVE_SETS.en : [])], [...TOEI_SETS.ja, ...(live ? TOEI_LIVE_SETS.ja : [])]);
}
/** The Toei Bus CC BY 4.0 credit (stops, routes and live positions of Toei buses). */
export function toeiBusCredit(lang = 'en') {
  return toeiFormat(lang, TOEI_BUS_SETS.en, TOEI_BUS_SETS.ja);
}
// Other bus operators' open data (CC BY 4.0 credits in the ODPT FAQ format, like Toei Bus): none in this build.
export const BUS_CREDITS = [];
/** A CC BY 4.0 credit in the ODPT FAQ format: creator `by` { en, ja }, its datasets `sets` { en: [...], ja: [...] }. */
export function ccCredit(lang, by, sets) {
  if (lang === 'ja') return `このアプリは、以下の著作物を改変して利用しています。 ${by.ja}、${sets.ja.join('・')}、クリエイティブ・コモンズ・ライセンス　表示4.0国際（${URLS.ccby.ja}）`;
  if (lang === 'id') return `Aplikasi ini memakai karya berhak cipta berikut dengan perubahan. ${by.en}, ${andList(sets.en)}, Creative Commons Atribusi 4.0 Internasional (${URLS.ccby.id})`;
  return `This app uses the following copyrighted material with modifications. ${by.en}, ${andList(sets.en)}, Creative Commons License Attribution 4.0 International (${URLS.ccby.en})`;
}
// Generic on purpose: this build's only live source is the licensed Toei feed, credited above.
const LIVE_NOTE = {
  en: 'Where a train’s delay is reported live, the train is moved by that delay.',
  ja: '遅れがリアルタイムで報告されている列車は、その遅れの分だけ位置を補正しています。',
  id: 'Jika keterlambatan sebuah kereta dilaporkan langsung, posisinya digeser sesuai keterlambatan itu.',
};

/** Is live (ODPT) data in use right now? ctx.live, else the page's window.__tokyo.live (live.js state() 'on'). */
export function liveOn(ctx = {}) {
  try {
    const live = ctx?.live ?? globalThis.__tokyo?.live;
    return live?.state?.()?.state === 'on';
  } catch { return false; }
}

/** The About blocks for one language. `source` (optional) = model.meta.source from the data pack:
 * { obtained: 'YYYY-MM-DD', ref, date } (written by `npm run data`).
 * `opts.live` = live Toei data is in use: the Toei credit then also names the live datasets.
 * `opts.bus` = { obtained } when the Toei Bus pack is loaded (else its date line is left out). */
export function creditsFor(lang = 'en', source = null, opts = {}) {
  const L = LANGS.includes(lang) ? lang : 'en';
  const live = !!opts?.live;
  const obtained = fmtDate(source?.obtained || DATA_OBTAINED || '', L) || ({ en: 'when you built it', ja: 'ビルド時', id: 'saat dibuat' })[L];
  const ref = source?.ref || SNAPSHOT.ref;
  const snap = fmtDate(source?.date || SNAPSHOT.date, L);
  const contact = CONTACT || CONTACT_PENDING[L];
  const busObtained = fmtDate(opts?.bus?.obtained || BUS_OBTAINED || '', L);
  const T = {
    en: {
      odpt: 'Public transportation data',
      asof: 'Data date',
      asofText: `Timetable data obtained ${obtained} from trafik.live’s train data file. Train positions on the map are worked out from these timetables.`,
      mt3d: 'Lines, stations and timetables',
      mt3dText: 'KRL timetable: KRL Commuter Line GTFS data compiled and verified by Open-KRL (github.com/open-krl), CC BY 4.0, as packaged by trafik.live together with its MRT, LRT and intercity timetables. Station coordinates © OpenStreetMap contributors, ODbL. LRT Jabodebek labels: Commute (ShioriLabs), MIT License. This app’s code is adapted from Tokyo Rail Twin (MIT License), parts of which are ported from Mini Tokyo 3D by Akihiko Kusanagi (MIT License).',
      toei: 'Toei lines (CC BY 4.0)',
      toeiBus: 'TransJakarta buses',
      busText: 'Bus routes, stops and timetable: GTFS PT Transportasi Jakarta (gtfs.transjakarta.co.id), modified. Buses on the map are simulated from this timetable (one bus per headway); they are not live positions.',
      busDate: `Bus stops and routes obtained ${busObtained}.`,
      map: 'Map',
      mapText: BASEMAP === 'protomaps' ? 'Map data © OpenStreetMap contributors, under the Open Database License. Basemap tiles from Protomaps, drawn with MapLibre.'
        : 'Map data © OpenStreetMap contributors, under the Open Database License. Basemap tiles: OpenFreeMap © OpenMapTiles. Drawn with MapLibre.',
      gsi: 'Ground heights',   // the 3D tunnel depths (elev-v2, npm run data:3d) use GSI elevation tiles
      gsiText: 'Ground heights: Geospatial Information Authority of Japan (GSI) elevation tiles, processed (used for the underground view\u2019s tunnel depths).',
      na: 'Not affiliated',
      naText: 'Not affiliated with KAI, KAI Commuter, MRT Jakarta, LRT Jakarta, trafik.live, Open-KRL or any railway operator. Times are planned times, not live positions.',
      lic: 'Licences',
      licText: 'Full licence texts and notices:',
    },
    ja: {
      odpt: '公共交通データ',
      asof: 'データの日付',
      asofText: `Timetable data obtained ${obtained} from trafik.live’s train data file. Train positions on the map are worked out from these timetables.`,
      mt3d: '路線・駅・時刻表',
      mt3dText: 'KRL timetable: KRL Commuter Line GTFS data compiled and verified by Open-KRL (github.com/open-krl), CC BY 4.0, as packaged by trafik.live together with its MRT, LRT and intercity timetables. Station coordinates © OpenStreetMap contributors, ODbL. LRT Jabodebek labels: Commute (ShioriLabs), MIT License. This app’s code is adapted from Tokyo Rail Twin (MIT License), parts of which are ported from Mini Tokyo 3D by Akihiko Kusanagi (MIT License).',
      toei: '都営交通（CC BY 4.0）',
      toeiBus: 'トランスジャカルタのバス',
      busText: 'バスの路線・停留所・時刻表：GTFS PT Transportasi Jakarta（gtfs.transjakarta.co.id）を加工して利用。地図上のバスはこの時刻表からのシミュレーション（運行間隔ごとに1台）で、実際の位置ではありません。',
      busDate: `バスの停留所・系統データの取得日: ${busObtained}。`,
      map: '地図',
      mapText: BASEMAP === 'protomaps' ? '地図データ © OpenStreetMap contributors（Open Database License）。背景地図タイルは Protomaps、描画は MapLibre を利用しています。'
        : '地図データ © OpenStreetMap contributors（Open Database License）。背景地図タイルは OpenFreeMap © OpenMapTiles、描画は MapLibre を利用しています。',
      gsi: '標高',
      gsiText: '出典：国土地理院（地理院タイル 標高タイル DEM5A・DEM5B・DEM10B）を加工して作成（地下表示のトンネルの深さに利用）',
      na: '提携関係',
      naText: 'Not affiliated with KAI, KAI Commuter, MRT Jakarta, LRT Jakarta, trafik.live, Open-KRL or any railway operator. Times are planned times, not live positions.',
      lic: 'ライセンス',
      licText: 'ライセンス全文と表示:',
    },
    id: {
      odpt: 'Data transportasi umum',
      asof: 'Tanggal data',
      asofText: `Data jadwal diambil ${obtained} dari berkas data kereta trafik.live. Posisi kereta di peta dihitung dari jadwal ini.`,
      mt3d: 'Jalur, stasiun, dan jadwal',
      mt3dText: 'Jadwal KRL: data GTFS KRL Commuter Line yang dihimpun dan diverifikasi Open-KRL (github.com/open-krl), CC BY 4.0, sebagaimana dikemas trafik.live bersama jadwal MRT, LRT, dan KA antarkota. Koordinat stasiun © kontributor OpenStreetMap, ODbL. Label LRT Jabodebek: Commute (ShioriLabs), Lisensi MIT. Kode aplikasi ini diadaptasi dari Tokyo Rail Twin (Lisensi MIT), yang sebagian kodenya diadaptasi dari Mini Tokyo 3D karya Akihiko Kusanagi (Lisensi MIT).',
      toei: 'Jalur Toei (CC BY 4.0)',
      toeiBus: 'Bus TransJakarta',
      busText: 'Rute, halte, dan jadwal bus: GTFS PT Transportasi Jakarta (gtfs.transjakarta.co.id), diolah. Bus di peta adalah simulasi dari jadwal ini (satu bus tiap headway), bukan posisi langsung.',
      busDate: `Data halte dan rute bus diambil ${busObtained}.`,
      map: 'Peta',
      mapText: BASEMAP === 'protomaps' ? 'Data peta © kontributor OpenStreetMap, dengan Open Database License. Peta dasar dari Protomaps, digambar dengan MapLibre.'
        : 'Data peta © kontributor OpenStreetMap, dengan Open Database License. Ubin peta dasar: OpenFreeMap © OpenMapTiles. Digambar dengan MapLibre.',
      gsi: 'Ketinggian tanah',
      gsiText: 'Ketinggian tanah: ubin elevasi Geospatial Information Authority of Japan (GSI), diolah (dipakai untuk kedalaman terowongan di tampilan bawah tanah).',
      na: 'Afiliasi',
      naText: 'Tidak berafiliasi dengan KAI, KAI Commuter, MRT Jakarta, LRT Jakarta, trafik.live, Open-KRL, atau operator kereta mana pun. Waktu yang tampil adalah waktu rencana, bukan posisi langsung.',
      lic: 'Lisensi',
      licText: 'Teks lisensi lengkap dan pemberitahuan:',
    },
  }[L];
  const odptLines = [...ODPT_NOTICE[L], contact];
  if (L === 'id') odptLines.push('(Terjemahan kami. Teks resmi dalam bahasa Jepang dan Inggris ada di LICENSES.txt.)');
  return [
    { key: 'asof', head: T.asof, lines: [live ? `${T.asofText}${L === 'ja' ? '' : ' '}${LIVE_NOTE[L]}` : T.asofText, ...(opts?.bus ? [T.busDate] : [])], links: [] }, // JA: sentences join without a space
    { key: 'mt3d', head: T.mt3d, lines: [T.mt3dText], links: [{ href: 'https://github.com/open-krl/pipeline', label: 'github.com/open-krl/pipeline' }, { href: 'https://trafik.live/kereta', label: 'trafik.live/kereta' }, { href: 'https://github.com/lucacadalora/tokyo-rail-twin', label: 'github.com/lucacadalora/tokyo-rail-twin' }, { href: URLS.mt3d, label: 'github.com/nagix/mini-tokyo-3d' }] },
    ...(opts?.bus || opts?.liveBus ? [{ key: 'toeiBus', head: T.toeiBus, lines: [T.busText], links: [{ href: 'https://gtfs.transjakarta.co.id/', label: 'gtfs.transjakarta.co.id' }] }] : []),
    ...BUS_CREDITS.map((b) => ({ key: b.key, head: L === 'ja' ? b.head.ja : b.head.en, lines: [ccCredit(L, b.by, b.sets)], links: [] })),
    { key: 'map', head: T.map, lines: [T.mapText], links: [{ href: URLS.osm, label: 'openstreetmap.org/copyright' },
      ...(BASEMAP === 'protomaps' ? [{ href: URLS.protomaps, label: 'protomaps.com' }] : [{ href: URLS.openfreemap, label: 'openfreemap.org' }, { href: URLS.openmaptiles, label: 'openmaptiles.org' }]),
      { href: URLS.maplibre, label: 'maplibre.org' }] },
    ...(opts?.gsi ? [{ key: 'gsi', head: T.gsi, lines: [T.gsiText], links: [{ href: 'https://maps.gsi.go.jp/development/ichiran.html', label: 'maps.gsi.go.jp' }] }] : []),
    { key: 'na', head: T.na, lines: [T.naText], links: [] },
    { key: 'lic', head: T.lic, lines: [T.licText], links: [{ href: URLS.licenses, label: 'LICENSES.txt' }] },
  ];
}

// ------------------------------------------------------------------ CCTV (cctv.js; shown once the camera pack is loaded)
/** The CCTV block: every owner in the camera pack's `sources` ({code: {name, owner, page}}), and whose video it is. */
export function cctvCredit(lang = 'en', sources = {}) {
  const L = LANGS.includes(lang) ? lang : 'en';
  const list = Object.values(sources || {});
  const owners = [...new Set(list.map((s) => s.owner))].join(L === 'ja' ? '、' : '; ');
  const text = {
    en: [`Traffic cameras of: ${owners}.`, `The video belongs to each owner and is loaded straight from the owner\u2019s server when you open a camera; ${APP_NAME} does not proxy, record or store it, and is not affiliated with any of them. Camera list compiled by trafik.live (no licence stated; not part of this repository).`],
    ja: [`交通カメラの提供元：${owners}。`, `映像は各提供元のもので、カメラを開いたときに提供元のサーバーから直接読み込みます。${APP_NAME} は映像を中継・録画・保存せず、いずれの提供元とも提携していません。カメラ一覧は trafik.live がまとめたものです（ライセンスの記載なし。このリポジトリには含まれません）。`],
    id: [`Kamera lalu lintas milik: ${owners}.`, `Video adalah milik masing-masing pemilik dan dimuat langsung dari server pemilik saat kamera dibuka; ${APP_NAME} tidak memproksi, merekam, atau menyimpannya, dan tidak berafiliasi dengan satu pun dari mereka. Daftar kamera disusun oleh trafik.live (tanpa lisensi yang dinyatakan; tidak termasuk dalam repositori ini).`],
  }[L];
  return { key: 'cctv', head: 'CCTV', lines: text, links: list.map((s) => ({ href: s.page, label: s.name })) };
}

/** credits = { en, ja, id }: the About blocks with today's constants (plain text, no HTML). */
export const credits = Object.fromEntries(LANGS.map((l) => [l, creditsFor(l)]));

// ------------------------------------------------------------------ map attribution + footer
export const attribution = BASEMAP === 'protomaps' ? '© OpenStreetMap contributors · Protomaps' : '© OpenStreetMap contributors · OpenFreeMap © OpenMapTiles';
export const attributionShort = '© OpenStreetMap';
export const attributionHtml = `<a href="${URLS.osm}" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · ${BASEMAP === 'protomaps'
  ? `<a href="${URLS.protomaps}" target="_blank" rel="noopener">Protomaps</a>`
  : `<a href="${URLS.openfreemap}" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="${URLS.openmaptiles}" target="_blank" rel="noopener">OpenMapTiles</a>`}`;
export const footer = {
  en: 'Timetable positions, not live · Data: Open-KRL (CC BY 4.0) via trafik.live · Map © OpenStreetMap contributors',
  ja: 'Timetable positions, not live · Data: Open-KRL (CC BY 4.0) via trafik.live · Map © OpenStreetMap contributors',
  id: 'Posisi menurut jadwal, bukan posisi langsung · Data: Open-KRL (CC BY 4.0) lewat trafik.live · Peta © kontributor OpenStreetMap',
};

// ------------------------------------------------------------------ HTML for page.js's About
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** About > Data and credits. ctx = page.js ctx() (lang, esc, model, bus?, gsi?); every part optional. */
export function creditsHtml(ctx = {}) {
  const esc = typeof ctx.esc === 'function' ? ctx.esc : escHtml;
  const blocks = creditsFor(ctx.lang, ctx.model?.meta?.source || null, { live: liveOn(ctx), bus: ctx.bus || null, liveBus: !!ctx.liveBus, gsi: !!ctx.gsi });
  if (ctx.cctv) blocks.splice(Math.max(0, blocks.length - 2), 0, cctvCredit(ctx.lang, ctx.cctv));   // before "not affiliated" + licences
  return blocks.map((b) => {
    const lines = b.lines.map((t, i) => {
      if (b.key === 'odpt' && i === ODPT_NOTICE.en.length) {
        return b.contact ? `<a href="mailto:${esc(b.contact)}">${esc(b.contact)}</a>` : `<i>${esc(t)}</i>`;
      }
      return esc(t);
    }).join('<br>');
    const links = b.links.map((k) => `<a href="${esc(k.href)}"${k.href.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${esc(k.label)}</a>`).join(' · ');
    return `<div data-credit="${esc(b.key)}"><b>${esc(b.head)}</b><span>${lines}${links ? `${b.key === 'lic' ? ' ' : '<br>'}${links}` : ''}</span></div>`;
  }).join('');
}

/** What must be set before a public deployment ([] = nothing). */
export function launchBlockers() {
  const out = [];
  if (!CONTACT) out.push('no contact address (TOKYO_CONTACT): ODPT guideline 3.1 (3) needs an inquiry address for the app');
  return out;
}
