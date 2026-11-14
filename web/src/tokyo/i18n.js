// Every UI string of the app, in three languages: EN / JA / ID.
// Feature modules add their keys in a marked block per module below, in all three languages.
//
//   import { t, tn, lang, setLang, title, onLang } from './i18n.js'
//   t('sched')                      -> 'Scheduled' | '時刻表どおり' | 'Menurut jadwal'
//   t('train.to', { name })         -> 'For Shinjuku' | '新宿行' | 'Ke Shinjuku'    ({x} placeholders, never HTML)
//   tn('n.trains', 3)               -> '3 trains' | '3本' | '3 kereta'           (EN picks `.one` for 1)
//   title({ en, ja })               -> the station / line name in the current language (ID uses `en`)
//
// Language: ?lang=ja|en|id in the URL, else the switch in About (kept in localStorage 'tokyo.lang'), else
// navigator.language (ja -> JA, id/ms -> ID, else EN). Times are WIB (UTC+9) on every screen.

import { APP_NAME } from '../project.js';

const STORE_KEY = 'tokyo.lang';
export const LANGS = [['en', 'English'], ['ja', '日本語'], ['id', 'Bahasa Indonesia']];
const LOCALE = { en: 'en-GB', ja: 'ja-JP', id: 'id-ID' };

const DICT = {
  en: {
    'brand': `${APP_NAME}`,
    'brand.tag': 'Trains of Greater Jakarta, by the timetable',
    'doc.title': `${APP_NAME} · trains of Greater Jakarta by the timetable`,
    'sched': 'Scheduled',
    'sched.long': 'Train positions are worked out from the timetable, not reported by the trains.',
    'sched.aria': 'Scheduled positions: what this means',
    'tab.map': 'Map', 'tab.lines': 'Lines', 'tab.stations': 'Stations', 'tabs': 'View',
    'search.ph': 'Search stations, lines or trains', 'search.ph.stations': 'Search stations', 'search.clear': 'Clear search',
    'q.none': 'Nothing found for “{q}”', 'q.none.sub': 'Check the spelling of the station name.',
    'about': 'About', 'about.open': `About ${APP_NAME}`, 'back': 'Back', 'close': 'Close',
    'locate': 'Stations near me', 'zoom.in': 'Zoom in', 'zoom.out': 'Zoom out', '3d': '3D', '3d.aria': '3D city', 'map.aria': 'Map of the trains of Greater Jakarta',
    'credit.na': 'Not affiliated with any railway operator', 'credit.osm': 'Map data © OpenStreetMap contributors',
    'credit.foot': 'Timetable positions, live where marked · Map data © OpenStreetMap contributors · Not affiliated with any railway operator',   // first phrase
    'load.t': 'Waiting for the train', 'load.s': 'Getting the map and the Greater Jakarta timetable ready',
    'load.fail': 'The map could not open', 'load.fail.gl': 'This browser cannot draw the map. The timetable still works below.',
    'load.fail.net': 'Check your connection, then try again.', 'retry': 'Try again',
    'data.fail': 'The timetable has not loaded', 'data.loading': 'Getting the timetable ready',
    'now.eyebrow': 'Now · {time} WIB', 'now.running': 'running by the timetable', 'now.lines': 'on {n} lines',
    'n.trains.one': '{n} train', 'n.trains': '{n} trains', 'n.lines.one': '{n} line', 'n.lines': '{n} lines',
    'n.stations.one': '{n} station', 'n.stations': '{n} stations', 'n.running': '{n} running',
    'none.running': 'No trains running now', 'first.train': 'First train {time} from {station}.',
    'my': 'My station', 'my.pick': 'Pick your station', 'my.pick.sub': 'Save the station you usually ride from: the next trains each way, and the last train of the night.',
    'my.change': 'Change', 'my.saved': 'My station: {name}', 'my.removed': 'My station removed', 'my.save': 'Save as my station', 'my.is': 'My station',
    'my.all': 'All trains at {name}', 'my.lines': 'Lines at {name}',
    'lines': 'Lines', 'lines.all': 'All {n} lines', 'lines.busiest': 'Busiest now', 'lines.op': 'By operator',
    'stations': 'Stations', 'stations.hubs': 'Big stations', 'stations.near': 'Stations near you',
    'station': 'Station', 'station.lines': 'Lines here', 'station.next': 'Next trains', 'station.none': 'No more trains in the timetable we have for today.',
    'train': 'Train', 'train.to': 'For {name}', 'train.from': 'From {name}', 'train.stops': 'Stops', 'train.no': 'Train {no}', 'train.gone': 'This train is not in today’s timetable.',
    'line': 'Line', 'line.stations': 'Stations', 'line.gone': 'This line is not in the data we have.',
    'min': '{n} min', 'dep.now': 'Departing', 'arr': 'arr.', 'dep': 'dep.',
    'loc.none': 'This browser cannot read your location. Pick a station from the list.', 'loc.denied': 'Location permission denied. Pick a station from the list.', 'loc.wait': 'Location not read yet. Try again in a moment.',
    'about.what': `${APP_NAME} puts every train of Greater Jakarta where its timetable says it is right now. Tap a train for its stops, a station for its next trains.`,
    'about.sched': 'Scheduled positions and times come from the operators’ timetables, not from the trains, so delays and cancellations are not shown: check the station announcements.',
    'about.live': 'Live position: the train is shown where it was last reported, with its delay. Estimated: a train that ran on from a reported line keeps that delay for a while. All other trains are Scheduled.',
    'about.today': 'Timetable today: {cal}.', 'cal.weekday': 'weekday', 'cal.holiday': 'Saturday and holiday', 'cal.saturday': 'Saturday', 'cal.sunday': 'Sunday and holiday',
    'about.lang': 'Language', 'about.data': 'Data and credits',
    'about.credits.fallback': 'Lines, stations and timetables: Mini Tokyo 3D (MIT License), © Akihiko Kusanagi. Map data © OpenStreetMap contributors.',
    'about.types': 'Train types', 'about.types.local': 'Local (各停 / 普通): stops at every station.',
    'about.types.rapid': 'Rapid (快速), Express (急行) and similar: skip some stations, so they are faster.',
    'about.types.ltd': 'Limited Express (Ltd. Exp., 特急): the fewest stops. Liners and some limited expresses (JR, Romancecar, Skyliner) need an extra ticket.',
    'credit.na.short': 'Not affiliated with rail operators',
    'data.date': 'Timetable data: Mini Tokyo 3D of {date}, obtained {obtained}.',
    'route.sub': 'From one station to another, with changes', 'route.from': 'Route from here', 'route.to': 'Route to here',
    'jst': 'WIB',
    'pill.est': 'Estimated', 'pill.est.aria': 'Estimated position: what this means', 'pill.live': 'Live position · {time}', 'buses.pb': 'Buses show live positions only: go back to now to see them.', 'update.reload': 'A newer version is out: reload the page.',
  },
  ja: {
    'brand': `${APP_NAME}`,
    'brand.tag': 'ジャカルタ首都圏の電車を時刻表どおりに',
    'doc.title': `${APP_NAME} · ジャカルタ首都圏の電車を時刻表どおりに`,
    'sched': '時刻表どおり',
    'sched.long': '列車の位置は時刻表から計算したもので、列車から送られた実際の位置ではありません。',
    'sched.aria': '時刻表どおりの位置について',
    'tab.map': '地図', 'tab.lines': '路線', 'tab.stations': '駅', 'tabs': '表示',
    'search.ph': '駅・路線・列車を検索', 'search.ph.stations': '駅を検索', 'search.clear': '検索をクリア',
    'q.none': '「{q}」は見つかりませんでした', 'q.none.sub': '駅名を日本語か英語で入力してください。',
    'about': 'このサイトについて', 'about.open': `${APP_NAME}について`, 'back': '戻る', 'close': '閉じる',
    'locate': '近くの駅', 'zoom.in': '拡大', 'zoom.out': '縮小', '3d': '3D', '3d.aria': '3Dの街', 'map.aria': 'ジャカルタ首都圏の電車の地図',
    'credit.na': '鉄道事業者とは関係ありません', 'credit.osm': '地図データ © OpenStreetMap contributors',
    'credit.foot': '時刻表どおりの位置（ライブ表示の列車を除く） · 地図データ © OpenStreetMap contributors · 鉄道事業者とは関係ありません',   // first phrase
    'load.t': '電車を待っています', 'load.s': '地図とジャカルタ首都圏の時刻表を準備しています',
    'load.fail': '地図を開けませんでした', 'load.fail.gl': 'このブラウザでは地図を表示できません。時刻表は下で見られます。',
    'load.fail.net': '接続を確認して、もう一度お試しください。', 'retry': 'もう一度',
    'data.fail': '時刻表を読み込めませんでした', 'data.loading': '時刻表を準備しています',
    'now.eyebrow': '現在 · {time}', 'now.running': '時刻表上で運行中', 'now.lines': '{n}路線',
    'n.trains': '{n}本', 'n.lines': '{n}路線', 'n.stations': '{n}駅', 'n.running': '{n}本運行中',
    'none.running': '現在運行中の列車はありません', 'first.train': '始発は{station}発 {time}です。',
    'my': 'マイ駅', 'my.pick': 'よく使う駅を選ぶ', 'my.pick.sub': 'いつも乗る駅を保存すると、方面ごとの次の電車と終電がすぐ見られます。',
    'my.change': '変更', 'my.saved': 'マイ駅: {name}', 'my.removed': 'マイ駅を解除しました', 'my.save': 'マイ駅にする', 'my.is': 'マイ駅',
    'my.all': '{name}駅のすべての列車', 'my.lines': '{name}駅の路線',
    'lines': '路線', 'lines.all': '全{n}路線', 'lines.busiest': '運行本数が多い路線', 'lines.op': '事業者別',
    'stations': '駅', 'stations.hubs': '主要駅', 'stations.near': '近くの駅',
    'station': '駅', 'station.lines': '乗り入れ路線', 'station.next': '次の電車', 'station.none': '本日の時刻表では、この後の列車はありません。',
    'train': '列車', 'train.to': '{name}行', 'train.from': '{name}発', 'train.stops': '停車駅', 'train.no': '列車番号 {no}', 'train.gone': 'この列車は本日の時刻表にありません。',
    'line': '路線', 'line.stations': '駅一覧', 'line.gone': 'この路線はデータにありません。',
    'min': '{n}分', 'dep.now': 'まもなく発車', 'arr': '着', 'dep': '発',
    'loc.none': 'このブラウザでは位置情報を使えません。リストから駅を選んでください。', 'loc.denied': '位置情報が許可されていません。リストから駅を選んでください。', 'loc.wait': '位置情報を取得できませんでした。少し待ってからもう一度お試しください。',
    'about.what': `${APP_NAME}は、ジャカルタ首都圏のすべての電車を時刻表上の現在位置に表示します。列車をタップすると停車駅、駅をタップすると次の電車が見られます。`,
    'about.sched': '時刻表どおりの位置と時刻は各事業者の時刻表によるもので、列車からの情報ではありません。遅延や運休は反映されません。駅の案内をご確認ください。',
    'about.live': '実際の位置: 最後に報告された位置と遅れで表示しています。推定: 報告のあった路線から直通した列車は、その遅れをしばらく引き継ぎます。その他の列車は時刻表どおりです。',
    'about.today': '本日は{cal}ダイヤです。', 'cal.weekday': '平日', 'cal.holiday': '土休日', 'cal.saturday': '土曜', 'cal.sunday': '日曜・祝日',
    'about.lang': '言語', 'about.data': 'データとクレジット',
    'about.credits.fallback': '路線・駅・時刻表: Mini Tokyo 3D（MITライセンス）© Akihiko Kusanagi。地図データ © OpenStreetMap contributors。',
    'about.types': '列車種別', 'about.types.local': '各駅停車・普通: すべての駅に停車します。',
    'about.types.rapid': '快速・急行など: 一部の駅を通過します。',
    'about.types.ltd': '特急: 停車駅が最も少ない列車です。ライナーや一部の特急（JR・ロマンスカー・スカイライナーなど）は特急券などが必要です。',
    'credit.na.short': '鉄道事業者とは関係ありません',
    'data.date': '時刻表データ: Mini Tokyo 3D（{date}版、{obtained}取得）。',
    'route.sub': '駅から駅まで、乗り換えも', 'route.from': 'ここから出発', 'route.to': 'ここへ行く',
    'jst': '日本時間',
    'pill.est': '推定', 'pill.est.aria': '推定位置について', 'pill.live': '実際の位置 · {time}時点', 'buses.pb': 'バスは実際の位置だけを表示します。現在の時刻に戻すと表示されます。', 'update.reload': '新しいバージョンがあります。ページを再読み込みしてください。',
  },
  id: {
    'brand': `${APP_NAME}`,
    'brand.tag': 'Kereta Jabodetabek, menurut jadwal',
    'doc.title': `${APP_NAME} · kereta Jabodetabek menurut jadwal`,
    'sched': 'Menurut jadwal',
    'sched.long': 'Posisi kereta dihitung dari jadwal, bukan laporan posisi dari kereta.',
    'sched.aria': 'Posisi menurut jadwal: apa artinya',
    'tab.map': 'Peta', 'tab.lines': 'Jalur', 'tab.stations': 'Stasiun', 'tabs': 'Tampilan',
    'search.ph': 'Cari stasiun, jalur, atau kereta', 'search.ph.stations': 'Cari stasiun', 'search.clear': 'Hapus pencarian',
    'q.none': 'Tidak ada hasil untuk “{q}”', 'q.none.sub': 'Periksa ejaan nama stasiunnya.',
    'about': 'Tentang', 'about.open': `Tentang ${APP_NAME}`, 'back': 'Kembali', 'close': 'Tutup',
    'locate': 'Stasiun di dekatku', 'zoom.in': 'Perbesar peta', 'zoom.out': 'Perkecil peta', '3d': '3D', '3d.aria': 'Kota 3D', 'map.aria': 'Peta kereta Jabodetabek',
    'credit.na': 'Tidak berafiliasi dengan operator kereta', 'credit.osm': 'Data peta © kontributor OpenStreetMap',
    'credit.foot': 'Posisi menurut jadwal, kecuali yang bertanda langsung · Data peta © kontributor OpenStreetMap · Tidak berafiliasi dengan operator kereta',   // first phrase
    'load.t': 'Menunggu kereta', 'load.s': 'Menyiapkan peta dan jadwal kereta Jabodetabek',
    'load.fail': 'Peta belum bisa dibuka', 'load.fail.gl': 'Browser ini belum bisa menggambar peta. Jadwal kereta tetap bisa dibuka di bawah.',
    'load.fail.net': 'Periksa koneksimu, lalu coba lagi.', 'retry': 'Coba lagi',
    'data.fail': 'Jadwal kereta belum termuat', 'data.loading': 'Menyiapkan jadwal kereta',
    'now.eyebrow': 'Sekarang · {time} WIB', 'now.running': 'jalan menurut jadwal', 'now.lines': 'di {n} jalur',
    'n.trains': '{n} kereta', 'n.lines': '{n} jalur', 'n.stations': '{n} stasiun', 'n.running': '{n} jalan',
    'none.running': 'Belum ada kereta yang jalan', 'first.train': 'Kereta pertama {time} dari {station}.',
    'my': 'Stasiunku', 'my.pick': 'Pilih stasiunmu', 'my.pick.sub': 'Simpan stasiun tempat kamu biasa naik: kereta berikutnya ke tiap arah dan kereta terakhir malam ini.',
    'my.change': 'Ganti', 'my.saved': 'Stasiunku: {name}', 'my.removed': 'Stasiunku dihapus', 'my.save': 'Jadikan Stasiunku', 'my.is': 'Stasiunku',
    'my.all': 'Semua kereta di {name}', 'my.lines': 'Jalur di {name}',
    'lines': 'Jalur', 'lines.all': 'Semua {n} jalur', 'lines.busiest': 'Paling banyak kereta sekarang', 'lines.op': 'Per operator',
    'stations': 'Stasiun', 'stations.hubs': 'Stasiun besar', 'stations.near': 'Stasiun di dekatmu',
    'station': 'Stasiun', 'station.lines': 'Jalur di sini', 'station.next': 'Kereta berikutnya', 'station.none': 'Tidak ada kereta lagi dalam jadwal hari ini.',
    'train': 'Kereta', 'train.to': 'Ke {name}', 'train.from': 'Dari {name}', 'train.stops': 'Pemberhentian', 'train.no': 'Kereta {no}', 'train.gone': 'Kereta ini tidak ada di jadwal hari ini.',
    'line': 'Jalur', 'line.stations': 'Stasiun', 'line.gone': 'Jalur ini tidak ada di data kami.',
    'min': '{n} mnt', 'dep.now': 'Berangkat', 'arr': 'tiba', 'dep': 'brkt',
    'loc.none': 'Browser ini tidak bisa membaca lokasi. Pilih stasiun dari daftar.', 'loc.denied': 'Izin lokasi ditolak. Pilih stasiun dari daftar.', 'loc.wait': 'Lokasi belum terbaca. Coba lagi sebentar.',
    'about.what': `${APP_NAME} menunjukkan posisi setiap kereta di Jabodetabek saat ini, menurut jadwalnya. Ketuk kereta untuk melihat pemberhentiannya, atau ketuk stasiun untuk melihat kereta berikutnya.`,
    'about.sched': 'Posisi dan waktu menurut jadwal berasal dari jadwal operator, bukan dari kereta, jadi keterlambatan dan pembatalan tidak tampil: perhatikan pengumuman di stasiun.',
    'about.live': 'Posisi langsung: kereta tampil di posisi terakhir yang dilaporkan, dengan keterlambatannya. Perkiraan: kereta yang lanjut dari jalur yang dilaporkan membawa keterlambatan itu untuk sementara. Kereta lain menurut jadwal.',
    'about.today': 'Jadwal hari ini: {cal}.', 'cal.weekday': 'hari kerja', 'cal.holiday': 'Sabtu dan hari libur', 'cal.saturday': 'Sabtu', 'cal.sunday': 'Minggu dan hari libur',
    'about.lang': 'Bahasa', 'about.data': 'Sumber data',
    'about.credits.fallback': 'Jalur, stasiun, dan jadwal: Mini Tokyo 3D (Lisensi MIT), © Akihiko Kusanagi. Data peta © kontributor OpenStreetMap.',
    'about.types': 'Jenis kereta', 'about.types.local': 'Local (各停 / 普通): berhenti di setiap stasiun.',
    'about.types.rapid': 'Rapid (快速), Express (急行), dan sejenisnya: lebih sedikit berhenti, jadi lebih cepat.',
    'about.types.ltd': 'Limited Express (Ltd. Exp., 特急): paling sedikit berhenti. Liner dan sebagian Limited Express (JR, Romancecar, Skyliner) perlu tiket tambahan.',
    'credit.na.short': 'Tidak berafiliasi dengan operator',
    'data.date': 'Data jadwal: Mini Tokyo 3D per {date}, diambil {obtained}.',
    'route.sub': 'Dari satu stasiun ke stasiun lain, dengan transit', 'route.from': 'Rute dari sini', 'route.to': 'Rute ke sini',
    'jst': 'WIB',
    'pill.est': 'Perkiraan', 'pill.est.aria': 'Posisi perkiraan: apa artinya', 'pill.live': 'Posisi langsung · per {time}', 'buses.pb': 'Bus hanya menampilkan posisi langsung: kembali ke sekarang untuk melihatnya.', 'update.reload': 'Ada versi baru: muat ulang halaman.',
  },
};

// ------------------------------------------------------------------ feature modules' keys
// One block per feature module below this line (the page's own keys are above):
//   // <module> keys
//   Object.assign(DICT.en, { 'board.dep': 'Departures' });
//   Object.assign(DICT.ja, { 'board.dep': '発車' });
//   Object.assign(DICT.id, { 'board.dep': 'Keberangkatan' });
// Prefix keys with the module's area ('board.', 'train.', 'search.', 'city3d.', 'live.', 'credits.', 'types.').

// train-view.js keys
Object.assign(DICT.en, {
  'line.suspended': 'Service suspended · replacement buses', 'line.suspended.nobus': 'Service suspended',
  'tv.live': 'Live position', 'tv.live.late': '{n} min late', 'tv.live.ontime': 'on time', 'tv.asof': 'as of {time}',
  'tv.timetable': 'timetable', 'tv.expected': 'expected {time}',
  'tv.note.live': 'Position and delay as reported by {op}; the times ahead are the timetable plus that delay.',
  'tv.note.asof': 'Data as of {time}.', 'lv.sched.rest': '{n} scheduled',
  'lv.note.live': 'Trains with the live mark are at their reported positions; the others are placed by the timetable. Tap a station for its next trains, a train for its stops.',
  'lv.live.all': 'Live positions', 'lv.live.some': '{n} live', 'lv.status': 'Service status', 'lv.since': 'since {time}',
  'tv.toward': 'for {names}', 'tv.between': 'Between {a} and {b}', 'tv.at': 'At {name}', 'tv.wait': 'At {name}, leaves {time}',
  'tv.before': 'Not left yet', 'tv.before.sub': 'from {name} at {time}', 'tv.done': 'Arrived', 'tv.done.sub': '{name} at {time}',
  'tv.now.here': 'Now here', 'tv.earlier.one': 'From {name} {time} · {n} stop passed', 'tv.earlier': 'From {name} {time} · {n} stops passed',
  'tv.show': 'Show', 'tv.less': 'Hide passed stops', 'tv.through': 'Through to {line}', 'tv.from.line': 'Through from {line}',
  'tv.lap': 'Carries on round the loop as {no}', 'tv.fork': 'Part of the train goes on via {line} to {name}',
  'tv.journey': 'One journey on {n} lines', 'tv.follow': 'Follow this train', 'tv.unfollow': 'Stop following',
  'tv.notfound': 'Train not found', 'tv.notfound.sub': 'Find it again from its station or line.',
  'tv.cars.one': '{n} car', 'tv.cars': '{n} cars', 'tv.stamp': 'Timetable: {stamp}.',
  'tv.note': 'Times are WIB from the operators’ timetables, and the position is worked out from them: it is not reported by the train. Listen to the station announcements.',
  'lv.running.one': '{n} train running', 'lv.running': '{n} trains running', 'lv.none': 'No trains on this line right now.',
  'lv.toward': 'for {name}', 'lv.loop': 'Loop: back to {name}', 'lv.trains': 'Trains on the line now', 'lv.strip': 'Stations and trains', 'lv.at': 'at {name}', 'lv.between': '{a} → {b}', 'lv.wait': 'leaves {name} {time}',
  'lv.note': 'Trains are placed by the timetable, not reported by the trains. Tap a station for its next trains, a train for its stops.',
});
Object.assign(DICT.ja, {
  'line.suspended': '運転見合わせ・代行バス運行中', 'line.suspended.nobus': '運転見合わせ',
  'tv.live': '実際の位置', 'tv.live.late': '{n}分遅れ', 'tv.live.ontime': '定刻', 'tv.asof': '{time}時点',
  'tv.timetable': '時刻表', 'tv.expected': '見込み {time}',
  'tv.note.live': '位置と遅れは{op}の情報です。この先の時刻は時刻表にその遅れを足したものです。',
  'tv.note.asof': '{time}時点の情報です。', 'lv.sched.rest': '{n}本は時刻表どおり',
  'lv.note.live': '実際の位置の列車は報告された位置に、その他の列車は時刻表から計算した位置に表示しています。駅をタップすると次の電車、列車をタップすると停車駅が見られます。',
  'lv.live.all': '実際の位置', 'lv.live.some': '{n}本は実際の位置', 'lv.status': '運行情報', 'lv.since': '{time}から',
  'tv.toward': '{names}方面', 'tv.between': '{a}〜{b}間', 'tv.at': '{name}に停車中', 'tv.wait': '{name}で発車待ち・{time}発',
  'tv.before': 'まだ出発していません', 'tv.before.sub': '{name} {time}発', 'tv.done': '到着しました', 'tv.done.sub': '{name} {time}着',
  'tv.now.here': 'いまここ', 'tv.earlier': '{name} {time}発 · 停車済み{n}駅',
  'tv.show': '表示', 'tv.less': '停車済みの駅を隠す', 'tv.through': '{line}に直通', 'tv.from.line': '{line}から直通',
  'tv.lap': '{no}として引き続き環状運転', 'tv.fork': '一部の車両は{line}経由で{name}へ',
  'tv.journey': '{n}路線を直通運転', 'tv.follow': 'この列車を追跡', 'tv.unfollow': '追跡をやめる',
  'tv.notfound': '列車が見つかりません', 'tv.notfound.sub': '駅や路線からもう一度探してください。',
  'tv.cars': '{n}両編成', 'tv.stamp': '時刻表: {stamp}',
  'tv.note': '時刻は各事業者の時刻表による日本時間です。位置は時刻表から計算したもので、列車からの情報ではありません。駅の案内に従ってください。',
  'lv.running': '{n}本運行中', 'lv.none': 'この路線には現在運行中の列車がありません。',
  'lv.toward': '{name}方面', 'lv.loop': '一周して{name}へ', 'lv.trains': '運行中の列車', 'lv.strip': '駅と列車', 'lv.at': '{name}に停車中', 'lv.between': '{a} → {b}', 'lv.wait': '{name} {time}発',
  'lv.note': '列車の位置は時刻表から計算したもので、列車からの情報ではありません。駅をタップすると次の電車、列車をタップすると停車駅が見られます。',
});
Object.assign(DICT.id, {
  'line.suspended': 'Layanan dihentikan · bus pengganti', 'line.suspended.nobus': 'Layanan dihentikan',
  'tv.live': 'Posisi langsung', 'tv.live.late': 'terlambat {n} mnt', 'tv.live.ontime': 'tepat waktu', 'tv.asof': 'per {time}',
  'tv.timetable': 'jadwal', 'tv.expected': 'perkiraan {time}',
  'tv.note.live': 'Posisi dan keterlambatan dilaporkan oleh {op}. Waktu selanjutnya dihitung dari jadwal ditambah keterlambatan itu.',
  'tv.note.asof': 'Data per pukul {time}.', 'lv.sched.rest': '{n} menurut jadwal',
  'lv.note.live': 'Kereta bertanda langsung ada di posisi yang dilaporkan. Kereta lain menurut jadwal. Ketuk stasiun untuk kereta berikutnya, ketuk kereta untuk pemberhentiannya.',
  'lv.live.all': 'Posisi langsung', 'lv.live.some': '{n} posisi langsung', 'lv.status': 'Status layanan', 'lv.since': 'sejak {time}',
  'tv.toward': 'arah {names}', 'tv.between': 'Antara {a} dan {b}', 'tv.at': 'Berhenti di {name}', 'tv.wait': 'Di {name}, berangkat {time}',
  'tv.before': 'Belum berangkat', 'tv.before.sub': 'dari {name} pukul {time}', 'tv.done': 'Sudah tiba', 'tv.done.sub': '{name} pukul {time}',
  'tv.now.here': 'Sekarang di sini', 'tv.earlier': 'Dari {name} {time} · lewat {n} stasiun',
  'tv.show': 'Lihat', 'tv.less': 'Sembunyikan stasiun yang sudah lewat', 'tv.through': 'Lanjut langsung ke {line}', 'tv.from.line': 'Datang langsung dari {line}',
  'tv.lap': 'Lanjut memutar sebagai {no}', 'tv.fork': 'Sebagian rangkaian lanjut lewat {line} ke {name}',
  'tv.journey': 'Satu perjalanan di {n} jalur', 'tv.follow': 'Ikuti kereta ini', 'tv.unfollow': 'Berhenti mengikuti',
  'tv.notfound': 'Kereta tidak ditemukan', 'tv.notfound.sub': 'Cari lagi lewat stasiun atau jalurnya.',
  'tv.cars': '{n} gerbong', 'tv.stamp': 'Jadwal: {stamp}.',
  'tv.note': 'Waktu dalam WIB dari jadwal operator. Posisi kereta dihitung dari jadwal itu, bukan laporan dari kereta. Perhatikan pengumuman di stasiun.',
  'lv.running': '{n} kereta jalan', 'lv.none': 'Belum ada kereta yang jalan di jalur ini sekarang.',
  'lv.toward': 'arah {name}', 'lv.loop': 'Kembali ke {name}', 'lv.trains': 'Kereta di jalur ini sekarang', 'lv.strip': 'Stasiun dan kereta', 'lv.at': 'di {name}', 'lv.between': '{a} → {b}', 'lv.wait': 'berangkat dari {name} {time}',
  'lv.note': 'Posisi kereta dihitung dari jadwal, bukan laporan dari kereta. Ketuk stasiun untuk kereta berikutnya, ketuk kereta untuk pemberhentiannya.',
});
// (end of train-view.js keys)

// board.js keys
Object.assign(DICT.en, {
  'board.for': 'For {name}', 'board.toward': 'For {names}', 'board.dir.for': 'For {name}', 'board.dir.toward': '{dir} · for {names}',
  'board.dir.InnerLoop': 'Inner Loop', 'board.dir.OuterLoop': 'Outer Loop', 'board.dir.Inbound': 'Inbound', 'board.dir.Outbound': 'Outbound',
  'board.dir.Eastbound': 'Eastbound', 'board.dir.Westbound': 'Westbound', 'board.dir.Southbound': 'Southbound', 'board.dir.Northbound': 'Northbound',
  'board.from.line': 'through from {line}', 'board.next.stop': 'next {name}',
  'board.where.here': 'starts here', 'board.where.platform': 'at the platform', 'board.where.at': 'at {name}', 'board.where.before': 'leaves {name} {time}',
  'board.last': 'Last train', 'board.last.for': 'Last for {name}', 'board.last.to': 'Last train for {name}', 'board.last.toward': 'Last for {names}', 'board.gone': 'The last train has left',
  'board.first.tomorrow': 'First train tomorrow', 'board.first.next': 'First train tomorrow {time}', 'board.then': 'then {time}',
  'board.none': 'No more trains this way in today’s timetable.', 'board.loading': 'Getting the rest of today’s timetable…',
  'board.night.t': 'The last trains have left', 'board.night.s': 'The last train from {name} left at {time}.',
  'board.night.first': 'Tomorrow’s first trains are below.', 'board.night.cal': 'Tomorrow runs another timetable: its first trains show after 03:00.',
  'board.lines.all': 'All', 'board.other.lines': 'Other lines', 'board.none.short': 'No more trains today', 'board.route.from': 'Route from here', 'board.route.to': 'Route to here',
  'board.svc': 'Service status', 'board.asof': 'as of {time}', 'board.svc.normal': '{ops} lines: normal service', 'board.svc.others': 'Other {ops} lines: normal service',
  'board.svc.cover': 'Status shown for {ops}. Other operators: timetable only.',
  'board.svc.cover.live': 'Service notices: {ops} only.', 'board.svc.livelink': 'Which lines are live now',
  'board.with': 'with {names}', 'board.at.st': 'from {name}', 'board.firstlast': 'First and last trains', 'board.first': 'First', 'board.lastw': 'Last',
  'board.more.lines.one': '{n} more line', 'board.more.lines': '{n} more lines', 'board.trains.word': 'trains',
  'board.chip.krl': 'KAI Commuter', 'board.chip.kai': 'KAI', 'board.chip.mrt': 'MRT Jakarta', 'board.chip.jbdb': 'LRT Jabodebek', 'board.chip.lrtj': 'LRT Jakarta', 'board.chip.other': 'Other',
  'board.chips': 'Operators', 'board.est': 'Estimated · {late}', 'board.firstlast.today': 'Today’s first and last trains',
  'board.ops': 'Running now, by operator', 'board.rhythm': 'How often trains come',
  'board.every': 'every ~{n} min', 'board.hour.one': '1 train in the next hour', 'board.next.at': 'next {time}', 'board.notrains': 'No trains in today’s timetable',
  'board.read.at': 'at {name}',
  'board.rhythm.note': '“Every ~4 min” is read from the next hour of the timetable at each line’s busiest station.',
  'board.note': 'Times are from the {cal} timetable, not reports from the trains. Through trains show where they end up. Listen to the station announcements.',
  'board.holiday': '{date} is a public holiday in Japan, so the Saturday and holiday timetable runs.',
});
Object.assign(DICT.ja, {
  'board.for': '{name}行', 'board.toward': '{names}方面', 'board.dir.for': '{name}方面', 'board.dir.toward': '{dir} {names}方面',
  'board.dir.InnerLoop': '内回り', 'board.dir.OuterLoop': '外回り', 'board.dir.Inbound': '上り', 'board.dir.Outbound': '下り',
  'board.dir.Eastbound': '東行', 'board.dir.Westbound': '西行', 'board.dir.Southbound': '南行', 'board.dir.Northbound': '北行',
  'board.from.line': '{line}から直通', 'board.next.stop': '次は{name}',
  'board.where.here': '当駅始発', 'board.where.platform': 'ホームに停車中', 'board.where.at': '{name}に停車中', 'board.where.before': '{name} {time}発',
  'board.last': '終電', 'board.last.for': '{name}行 最終', 'board.last.to': '{name}行 終電', 'board.last.toward': '{names}方面 最終', 'board.gone': '終電は出発しました',
  'board.first.tomorrow': '明日の始発', 'board.first.next': '明日の始発 {time}', 'board.then': '次 {time}',
  'board.none': '本日の時刻表では、この方面の列車はもうありません。', 'board.loading': 'この後の時刻表を読み込んでいます…',
  'board.night.t': '本日の運転は終了しました', 'board.night.s': '{name}の終電は{time}に出発しました。',
  'board.night.first': '下に明日の始発を表示しています。', 'board.night.cal': '明日は別のダイヤです。始発は3時以降に表示します。',
  'board.lines.all': 'すべて', 'board.other.lines': 'ほかの路線', 'board.none.short': '本日の運転は終了', 'board.route.from': 'ここから出発', 'board.route.to': 'ここへ行く',
  'board.svc': '運行情報', 'board.asof': '{time}現在', 'board.svc.normal': '{ops}線: 平常運転', 'board.svc.others': 'その他の{ops}線: 平常運転',
  'board.svc.cover': '運行情報は{ops}のみ表示しています。その他の事業者は時刻表のみです。',
  'board.svc.cover.live': '運行情報は{ops}のみ表示しています。', 'board.svc.livelink': 'リアルタイム表示の路線',
  'board.with': '{names}を含む', 'board.at.st': '{name}駅から', 'board.firstlast': '始発・終電', 'board.first': '始発', 'board.lastw': '終電',
  'board.more.lines': 'ほか{n}路線', 'board.trains.word': '本',
  'board.chip.krl': 'KAI Commuter', 'board.chip.kai': 'KAI', 'board.chip.mrt': 'MRT Jakarta', 'board.chip.jbdb': 'LRT Jabodebek', 'board.chip.lrtj': 'LRT Jakarta', 'board.chip.other': 'Other',
  'board.chips': '事業者', 'board.est': '推定 · {late}', 'board.firstlast.today': '本日の始発・終電',
  'board.ops': '事業者別の運行中の列車', 'board.rhythm': '運転間隔',
  'board.every': '約{n}分間隔', 'board.hour.one': '1時間に1本', 'board.next.at': '次は{time}', 'board.notrains': '本日の時刻表に列車がありません',
  'board.read.at': '{name}駅',
  'board.rhythm.note': '「約4分間隔」は各路線で最も本数の多い駅の、この先1時間の時刻表から計算しています。',
  'board.note': '時刻は{cal}ダイヤによるもので、列車からの情報ではありません。直通列車は最終的な行先を表示しています。駅の案内に従ってください。',
  'board.holiday': '{date}は祝日のため、土休日ダイヤで運転します。',
});
Object.assign(DICT.id, {
  'board.for': 'Ke {name}', 'board.toward': 'Arah {names}', 'board.dir.for': 'Arah {name}', 'board.dir.toward': '{dir} · ke {names}',
  'board.dir.InnerLoop': 'Lingkar dalam', 'board.dir.OuterLoop': 'Lingkar luar', 'board.dir.Inbound': 'Arah pusat', 'board.dir.Outbound': 'Arah luar kota',
  'board.dir.Eastbound': 'Arah timur', 'board.dir.Westbound': 'Arah barat', 'board.dir.Southbound': 'Arah selatan', 'board.dir.Northbound': 'Arah utara',
  'board.from.line': 'datang langsung dari {line}', 'board.next.stop': 'berikutnya {name}',
  'board.where.here': 'berangkat dari sini', 'board.where.platform': 'sudah di peron', 'board.where.at': 'di {name}', 'board.where.before': 'berangkat dari {name} {time}',
  'board.last': 'Kereta terakhir', 'board.last.for': 'Terakhir ke {name}', 'board.last.to': 'Kereta terakhir ke {name}', 'board.last.toward': 'Terakhir arah {names}', 'board.gone': 'Kereta terakhir sudah berangkat',
  'board.first.tomorrow': 'Kereta pertama besok', 'board.first.next': 'Kereta pertama besok {time}', 'board.then': 'lalu {time}',
  'board.none': 'Tidak ada kereta lagi ke arah ini dalam jadwal hari ini.', 'board.loading': 'Memuat sisa jadwal hari ini…',
  'board.night.t': 'Kereta terakhir sudah lewat', 'board.night.s': 'Kereta terakhir dari {name} sudah berangkat pukul {time}.',
  'board.night.first': 'Di bawah ini kereta pertama besok.', 'board.night.cal': 'Besok memakai jadwal lain: kereta pertamanya tampil setelah pukul 03.00.',
  'board.lines.all': 'Semua', 'board.other.lines': 'Jalur lain', 'board.none.short': 'Tidak ada kereta lagi hari ini', 'board.route.from': 'Rute dari sini', 'board.route.to': 'Rute ke sini',
  'board.svc': 'Status layanan', 'board.asof': 'per {time}', 'board.svc.normal': 'Jalur {ops}: berjalan normal', 'board.svc.others': 'Jalur {ops} lainnya: berjalan normal',
  'board.svc.cover': 'Status layanan hanya tersedia untuk {ops}. Operator lain hanya menurut jadwal.',
  'board.svc.cover.live': 'Status layanan hanya tersedia untuk {ops}.', 'board.svc.livelink': 'Jalur dengan posisi langsung',
  'board.with': 'termasuk {names}', 'board.at.st': 'dari {name}', 'board.firstlast': 'Kereta pertama dan terakhir', 'board.first': 'Pertama', 'board.lastw': 'Terakhir',
  'board.more.lines': '{n} jalur lagi', 'board.trains.word': 'kereta',
  'board.chip.krl': 'KAI Commuter', 'board.chip.kai': 'KAI', 'board.chip.mrt': 'MRT Jakarta', 'board.chip.jbdb': 'LRT Jabodebek', 'board.chip.lrtj': 'LRT Jakarta', 'board.chip.other': 'Lainnya',
  'board.chips': 'Operator', 'board.est': 'Perkiraan · {late}', 'board.firstlast.today': 'Kereta pertama dan terakhir hari ini',
  'board.ops': 'Kereta jalan, per operator', 'board.rhythm': 'Seberapa sering kereta datang',
  'board.every': 'tiap ~{n} mnt', 'board.hour.one': '1 kereta dalam sejam', 'board.next.at': 'berikutnya {time}', 'board.notrains': 'Tidak ada kereta dalam jadwal hari ini',
  'board.read.at': 'di {name}',
  'board.rhythm.note': '“Tiap ~4 mnt” dibaca dari jadwal satu jam ke depan di stasiun tersibuk tiap jalur.',
  'board.note': 'Waktu dihitung dari jadwal {cal}, bukan laporan dari kereta. Kereta terusan menampilkan tujuan akhirnya. Perhatikan pengumuman di stasiun.',
  'board.holiday': '{date} hari libur nasional di Jepang, jadi berlaku jadwal Sabtu dan hari libur.',
});
// (end of board.js keys)

// LIVE keys (live.js 'live.*'; only shown when live data is on. Source-neutral except live.credit*, which
// views show only for ODPT data via live.creditOf(); other sources are never named.)
Object.assign(DICT.en, {
  'live': 'Live', 'live.long': 'Position from live train data, moved by the reported delay.',
  'live.late': '{n} min late', 'live.late.short': '+{n} min', 'live.ontime': 'On time', 'live.updated': 'Live data {time}',
  'live.sev.normal': 'Good service', 'live.sev.info': 'Service notice', 'live.sev.delay': 'Delays', 'live.sev.suspended': 'Suspended',
  'live.resume': 'Expected to run again around {time}', 'live.ja.only': 'Notice in Japanese only',
  'live.pos': 'Live position · {late} · as of {time}', 'live.pos.late': '{n} min late', 'live.pos.ontime': 'on time',
  'live.pos.only': 'Live position · as of {time}',
  'live.note': 'Live position. The times ahead are the timetable, moved to where the train was reported.',
  'live.est': 'Estimated · {late} (last report {station} {time})', 'live.est.late': 'about {n} min late', 'live.est.ontime': 'about on time',
  'live.credit': 'Live train data: Public Transportation Open Data Center (ODPT). Accuracy and completeness are not guaranteed. Please do not contact the railway operators about this app.',
  'live.credit.toei': 'Toei data: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation (CC BY 4.0).',
});
Object.assign(DICT.ja, {
  'live': 'リアルタイム', 'live.long': 'リアルタイムの列車データによる位置です（報告された遅れを反映）。',
  'live.late': '{n}分遅れ', 'live.late.short': '+{n}分', 'live.ontime': '定刻', 'live.updated': '{time}更新',
  'live.sev.normal': '平常運転', 'live.sev.info': '運行情報', 'live.sev.delay': '遅延', 'live.sev.suspended': '運転見合わせ',
  'live.resume': '{time}頃 運転再開見込み', 'live.ja.only': '日本語のみ',
  'live.pos': '実際の位置 · {late} · {time}時点', 'live.pos.late': '{n}分遅れ', 'live.pos.ontime': '定刻',
  'live.pos.only': '実際の位置 · {time}時点',
  'live.note': '実際の位置です。この先の時刻は、時刻表を列車が報告された位置に合わせてずらしたものです。',
  'live.est': '推定 · {late}（{station} {time} の情報）', 'live.est.late': '約{n}分遅れ', 'live.est.ontime': 'ほぼ定刻',
  'live.credit': '列車のリアルタイム情報：公共交通オープンデータセンター。データの正確性・完全性は保証されません。本アプリについて交通事業者へのお問い合わせはご遠慮ください。',
  'live.credit.toei': '都営交通のデータ：東京都交通局・公共交通オープンデータ協議会（CC BY 4.0）',
});
Object.assign(DICT.id, {
  'live': 'Langsung', 'live.long': 'Posisi dari data kereta langsung, digeser sesuai keterlambatan yang dilaporkan.',
  'live.late': 'terlambat {n} mnt', 'live.late.short': '+{n} mnt', 'live.ontime': 'Tepat waktu', 'live.updated': 'Data langsung {time}',
  'live.sev.normal': 'Normal', 'live.sev.info': 'Info layanan', 'live.sev.delay': 'Terlambat', 'live.sev.suspended': 'Dihentikan sementara',
  'live.resume': 'Diperkirakan jalan lagi sekitar {time}', 'live.ja.only': 'Info hanya dalam bahasa Jepang',
  'live.pos': 'Posisi langsung · {late} · per {time}', 'live.pos.late': 'terlambat {n} mnt', 'live.pos.ontime': 'tepat waktu',
  'live.pos.only': 'Posisi langsung · per {time}',
  'live.note': 'Ini posisi langsung. Waktu selanjutnya dihitung dari jadwal, disesuaikan dengan posisi kereta yang dilaporkan.',
  'live.est': 'Perkiraan · {late} (laporan terakhir {station} {time})', 'live.est.late': 'terlambat sekitar {n} mnt', 'live.est.ontime': 'sekitar tepat waktu',
  'live.credit': 'Data kereta langsung: Public Transportation Open Data Center (ODPT). Akurasi dan kelengkapan tidak dijamin. Mohon jangan menghubungi operator kereta tentang aplikasi ini.',
  'live.credit.toei': 'Data Toei: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation (CC BY 4.0).',
});
// (end of LIVE keys)

// search.js keys
Object.assign(DICT.en, {
  'search.stations': 'Stations', 'search.lines': 'Lines', 'search.count': '{n} found', 'search.lineStations': '{n} stations',
  'search.transfer': 'Transfer: {names}', 'search.stationLabel': '{name} station',
  'search.none': 'Nothing found for “{q}”',
  'search.try': 'Try a station (Manggarai, Sudirman) or a line (Bogor, MRT).',
  'search.hint': 'Type a station or line: Manggarai, Sudirman, Bogor.',
  'search.near': 'Near you', 'search.nearSmall': 'walking, estimated', 'search.nearBtn': 'Stations near me',
  'search.nearSub': 'Uses your location once, only on this device', 'search.nearWait': 'Finding where you are…',
  'search.nearDenied': 'Location is off for this site. Search by name instead.',
  'search.nearFail': 'Your location did not come through. Try again in a moment.',
  'search.nearFar': 'No station within 30 km. This map covers Greater Jakarta.', 'search.walk': '{min} min walk · {dist}',
});
Object.assign(DICT.ja, {
  'search.stations': '駅', 'search.lines': '路線', 'search.count': '{n}件', 'search.lineStations': '{n}駅',
  'search.transfer': '乗換: {names}', 'search.stationLabel': '{name}駅',
  'search.none': '「{q}」は見つかりませんでした',
  'search.try': '駅名（新宿、Shinjuku）、路線名（山手線、銀座線）、駅ナンバリング（JY17）で探せます。',
  'search.hint': '駅名・路線名を日本語か英語で入力: 新宿、Shinjuku、JY17、銀座線',
  'search.near': '近くの駅', 'search.nearSmall': '徒歩の目安', 'search.nearBtn': '近くの駅を探す',
  'search.nearSub': '現在地はこの端末内で一度だけ使います', 'search.nearWait': '現在地を確認しています…',
  'search.nearDenied': 'このサイトの位置情報がオフです。駅名で検索してください。',
  'search.nearFail': '現在地を取得できませんでした。少し待ってからもう一度お試しください。',
  'search.nearFar': '30 km以内に駅がありません。この地図はジャカルタ首都圏の鉄道です。', 'search.walk': '徒歩{min}分（{dist}）',
});
Object.assign(DICT.id, {
  'search.stations': 'Stasiun', 'search.lines': 'Jalur', 'search.count': '{n} hasil', 'search.lineStations': '{n} stasiun',
  'search.transfer': 'Transit: {names}', 'search.stationLabel': 'Stasiun {name}',
  'search.none': 'Tidak ada hasil untuk “{q}”',
  'search.try': 'Coba nama stasiun (Manggarai, Sudirman) atau jalur (Bogor, MRT).',
  'search.hint': 'Ketik stasiun atau jalur: Manggarai, Sudirman, Bogor.',
  'search.near': 'Di dekatmu', 'search.nearSmall': 'perkiraan jalan kaki', 'search.nearBtn': 'Stasiun di dekatku',
  'search.nearSub': 'Lokasimu dipakai sekali, di perangkat ini', 'search.nearWait': 'Mencari lokasimu…',
  'search.nearDenied': 'Akses lokasi untuk situs ini nonaktif. Cari dengan nama stasiun.',
  'search.nearFail': 'Lokasi belum terbaca. Coba lagi sebentar.',
  'search.nearFar': 'Tidak ada stasiun dalam 30 km. Peta ini mencakup Jabodetabek.', 'search.walk': 'Jalan kaki {min} mnt · {dist}',
});
// (end of search.js keys)

// the 3D city keys (the 3D view's controls; web/src/layers/city3d/index.js mountCity3d: setUnderground, flyTo
// presets 'shinjuku' | 'shibuya' | 'tokyo' | 'ikebukuro'; 'city3d.weak' when setOn() returns false (no WebGL2))
Object.assign(DICT.en, {
  'city3d.underground': 'Underground', 'city3d.underground.aria': 'Show the underground: subway lines and their trains at depth',
  'city3d.underground.on': 'Showing the underground', 'city3d.goto': 'Fly to', 'city3d.weak': 'This device cannot draw the 3D city',
  'city3d.p.shinjuku': 'Manggarai', 'city3d.p.shibuya': 'Sudirman', 'city3d.p.tokyo': 'Gambir', 'city3d.p.ikebukuro': 'Jakarta Kota',
  'city3d.note': 'Buildings © OpenStreetMap contributors. Track heights are our estimate. Trains are placed by the timetable.',
});
Object.assign(DICT.ja, {
  'city3d.underground': '地下', 'city3d.underground.aria': '地下を表示: 地下鉄の路線と電車を地下の深さで',
  'city3d.underground.on': '地下を表示中', 'city3d.goto': '移動', 'city3d.weak': 'この端末では3Dの街を表示できません',
  'city3d.p.shinjuku': 'Manggarai', 'city3d.p.shibuya': 'Sudirman', 'city3d.p.tokyo': 'Gambir', 'city3d.p.ikebukuro': 'Jakarta Kota',
  'city3d.note': '建物 © OpenStreetMap contributors。線路の高さは推定です。電車の位置は時刻表どおりです。',
});
Object.assign(DICT.id, {
  'city3d.underground': 'Bawah tanah', 'city3d.underground.aria': 'Tampilkan bawah tanah: jalur kereta bawah tanah dan keretanya di kedalamannya',
  'city3d.underground.on': 'Menampilkan bawah tanah', 'city3d.goto': 'Terbang ke', 'city3d.weak': 'Perangkat ini belum bisa menampilkan kota 3D',
  'city3d.p.shinjuku': 'Manggarai', 'city3d.p.shibuya': 'Sudirman', 'city3d.p.tokyo': 'Gambir', 'city3d.p.ikebukuro': 'Jakarta Kota',
  'city3d.note': 'Gedung © kontributor OpenStreetMap. Tinggi rel adalah perkiraan kami. Posisi kereta menurut jadwal.',
});
// (end of the 3D city keys)

// ROUTE keys
Object.assign(DICT.en, {
  'rt.title': 'Route', 'rt.open': 'Plan a trip', 'rt.from': 'From', 'rt.to': 'To',
  'rt.from.ph': 'From: station', 'rt.to.ph': 'To: station', 'rt.swap': 'Swap from and to', 'rt.clear': 'Clear',
  'rt.now': 'Now', 'rt.dep': 'Leave at', 'rt.arr': 'Arrive by', 'rt.time': 'Time',
  'rt.fare': 'Limited express trains', 'rt.fare.sub': 'Skyliner, N’EX, Romancecar and liners need an extra ticket',
  'rt.options': 'Ways to go', 'rt.options.sub': 'Up to 4 changes', 'rt.min': '{n} min', 'rt.hm': '{h} h {m} min',
  'rt.chg.0': 'No change', 'rt.chg.one': '1 change', 'rt.chg': '{n} changes',
  'rt.found': '{n} ways · fastest {dur}', 'rt.fast': 'Fastest', 'rt.few': 'Fewest changes', 'rt.for': 'for {name}', 'rt.stops.one': '1 stop', 'rt.stops': '{n} stops',
  'rt.through': 'Stays on at {name} as the {line}', 'rt.change': 'Change at {name}', 'rt.walk': 'Walk to {name}',
  'rt.walk.start': 'Walk to {name}', 'rt.walk.end': 'Walk to where you are going', 'rt.walk.only': 'Walk',
  'rt.leave': 'Leave {time}', 'rt.arrive': 'Arrive {time}', 'rt.extra': 'Extra fare', 'rt.ride': '{min} on the train',
  'rt.none': 'No way found', 'rt.none.sub': 'Nothing with up to 4 changes in the next 4 hours of the timetable.',
  'rt.same': 'That is the same station', 'rt.pick': 'Pick where you start and where you are going.',
  'rt.loading': 'Reading the timetable', 'rt.fail': 'The timetable did not load. Try again.', 'rt.nextday': 'Last trains have gone: first trains tomorrow',
  'rt.note': 'Times are from the timetable, not live. Check the station for delays and platforms.',
  'rt.here': 'My location', 'rt.here.sub': 'Stations within a 10 minute walk', 'rt.here.wait': 'Finding you', 'rt.here.no': 'Location not available',
  'rt.train': 'See this train', 'rt.show': 'Show on the map', 'rt.from.here': 'Route from here', 'rt.to.here': 'Route to here',
  'rt.tomorrow': 'tomorrow', 'rt.leave.in': 'leaves in {n} min', 'rt.leave.now': 'leaves now',
});
Object.assign(DICT.ja, {
  'rt.title': '乗換案内', 'rt.open': '経路を調べる', 'rt.from': '出発', 'rt.to': '到着',
  'rt.from.ph': '出発駅', 'rt.to.ph': '到着駅', 'rt.swap': '出発と到着を入れ替え', 'rt.clear': 'クリア',
  'rt.now': '現在時刻', 'rt.dep': '出発時刻', 'rt.arr': '到着時刻', 'rt.time': '時刻',
  'rt.fare': '有料特急を使う', 'rt.fare.sub': 'スカイライナー・成田エクスプレス・ロマンスカー・ライナーは特急券などが必要です',
  'rt.options': '経路', 'rt.options.sub': '乗換4回まで', 'rt.min': '{n}分', 'rt.hm': '{h}時間{m}分',
  'rt.chg.0': '乗換なし', 'rt.chg': '乗換{n}回',
  'rt.found': '{n}件 · 最速{dur}', 'rt.fast': '最速', 'rt.few': '乗換最少', 'rt.for': '{name}行', 'rt.stops': '{n}駅',
  'rt.through': '{name}から{line}に直通（乗ったまま）', 'rt.change': '{name}で乗換', 'rt.walk': '{name}まで歩く',
  'rt.walk.start': '{name}まで歩く', 'rt.walk.end': '目的地まで歩く', 'rt.walk.only': '徒歩',
  'rt.leave': '{time}発', 'rt.arrive': '{time}着', 'rt.extra': '特急券', 'rt.ride': '乗車{min}',
  'rt.none': '経路が見つかりません', 'rt.none.sub': '時刻表のこれから4時間以内に、乗換4回までの経路はありません。',
  'rt.same': '同じ駅です', 'rt.pick': '出発駅と到着駅を選んでください。',
  'rt.loading': '時刻表を確認しています', 'rt.fail': '時刻表を読み込めませんでした。もう一度お試しください。', 'rt.nextday': '終電後のため、翌日の始発です',
  'rt.note': '時刻は時刻表どおりで、遅れは反映していません。最新の情報は駅の案内でご確認ください。',
  'rt.here': '現在地', 'rt.here.sub': '歩いて10分以内の駅', 'rt.here.wait': '現在地を確認しています', 'rt.here.no': '現在地を取得できません',
  'rt.train': 'この列車を見る', 'rt.show': '地図に表示', 'rt.from.here': 'ここから出発', 'rt.to.here': 'ここへ行く',
  'rt.tomorrow': '翌日', 'rt.leave.in': '{n}分後に発車', 'rt.leave.now': 'まもなく発車',
});
Object.assign(DICT.id, {
  'rt.title': 'Rute', 'rt.open': 'Cari rute', 'rt.from': 'Dari', 'rt.to': 'Ke',
  'rt.from.ph': 'Dari: stasiun', 'rt.to.ph': 'Ke: stasiun', 'rt.swap': 'Tukar asal dan tujuan', 'rt.clear': 'Hapus',
  'rt.now': 'Sekarang', 'rt.dep': 'Berangkat', 'rt.arr': 'Tiba sebelum', 'rt.time': 'Jam',
  'rt.fare': 'Termasuk Limited Express', 'rt.fare.sub': 'Skyliner, N’EX, Romancecar, dan liner perlu tiket tambahan',
  'rt.options': 'Pilihan rute', 'rt.options.sub': 'Paling banyak 4 kali ganti', 'rt.min': '{n} mnt', 'rt.hm': '{h} jam {m} mnt',
  'rt.chg.0': 'Tanpa ganti kereta', 'rt.chg.one': '1 kali ganti', 'rt.chg': '{n} kali ganti',
  'rt.found': '{n} rute · tercepat {dur}', 'rt.fast': 'Tercepat', 'rt.few': 'Paling sedikit ganti', 'rt.for': 'ke {name}', 'rt.stops.one': '1 stasiun', 'rt.stops': '{n} stasiun',
  'rt.through': 'Tetap di kereta di {name}, lanjut sebagai {line}', 'rt.change': 'Ganti kereta di {name}', 'rt.walk': 'Jalan kaki ke {name}',
  'rt.walk.start': 'Jalan kaki ke {name}', 'rt.walk.end': 'Jalan kaki ke tujuan', 'rt.walk.only': 'Jalan kaki',
  'rt.leave': 'Berangkat {time}', 'rt.arrive': 'Tiba {time}', 'rt.extra': 'Tiket tambahan', 'rt.ride': '{min} di kereta',
  'rt.none': 'Rute tidak ditemukan', 'rt.none.sub': 'Tidak ada rute dengan paling banyak 4 kali ganti dalam 4 jam ke depan di jadwal.',
  'rt.same': 'Itu stasiun yang sama', 'rt.pick': 'Pilih stasiun asal dan tujuan.',
  'rt.loading': 'Membaca jadwal', 'rt.fail': 'Jadwal belum termuat. Coba lagi.', 'rt.nextday': 'Kereta terakhir sudah lewat: kereta pertama besok',
  'rt.note': 'Waktu menurut jadwal, bukan data langsung. Perhatikan pengumuman di stasiun untuk keterlambatan dan peron.',
  'rt.here': 'Lokasiku', 'rt.here.sub': 'Stasiun dalam 10 menit jalan kaki', 'rt.here.wait': 'Mencari lokasimu', 'rt.here.no': 'Lokasi tidak tersedia',
  'rt.train': 'Lihat kereta ini', 'rt.show': 'Tampilkan di peta', 'rt.from.here': 'Rute dari sini', 'rt.to.here': 'Rute ke sini',
  'rt.tomorrow': 'besok', 'rt.leave.in': 'berangkat {n} mnt lagi', 'rt.leave.now': 'berangkat sekarang',
});
// route-live.js keys, in the ROUTE block
Object.assign(DICT.en, {
  'rt.lv.live': '{n} min late · live', 'rt.lv.live0': 'On time · live', 'rt.lv.est': 'About {n} min late · estimated', 'rt.lv.est0': 'About on time · estimated', 'rt.lv.pos': 'Live position', 'rt.live.some': 'Live where marked', 'rt.note.live': 'Marked trains include their latest delay. Other times are from the timetable. Check the station for platforms.',
});
Object.assign(DICT.ja, {
  'rt.lv.live': '{n}分遅れ · リアルタイム', 'rt.lv.live0': '定刻 · リアルタイム', 'rt.lv.est': '約{n}分遅れ · 推定', 'rt.lv.est0': 'ほぼ定刻 · 推定', 'rt.lv.pos': '実際の位置', 'rt.live.some': '表示のある列車はリアルタイム', 'rt.note.live': '表示のある列車は最新の遅れを反映しています。その他の時刻は時刻表どおりです。最新の情報は駅の案内でご確認ください。',
});
Object.assign(DICT.id, {
  'rt.lv.live': 'Terlambat {n} mnt · data langsung', 'rt.lv.live0': 'Tepat waktu · data langsung', 'rt.lv.est': 'Terlambat sekitar {n} mnt · perkiraan', 'rt.lv.est0': 'Sekitar tepat waktu · perkiraan', 'rt.lv.pos': 'Posisi langsung', 'rt.live.some': 'Data langsung pada kereta yang ditandai', 'rt.note.live': 'Kereta yang ditandai sudah memperhitungkan keterlambatan terbaru. Waktu lainnya menurut jadwal. Perhatikan pengumuman di stasiun.',
});
// (end of ROUTE keys)

// exits.js keys
Object.assign(DICT.en, {
  'exits': 'Exits', 'exits.n': '{n} exits', 'exits.n.one': '{n} exit', 'exits.more': 'Show all {n}', 'exits.less': 'Show fewer',
  'exits.show': '{name}: show on the map', 'exits.missing': 'No exit data for {ops}.',
  'exits.f.stairs': 'Stairs', 'exits.f.escalator': 'Escalator', 'exits.f.elevator': 'Elevator', 'exits.f.ramp': 'Ramp',
  'exits.closed': 'Closed', 'exits.closed.today': 'Closed today', 'exits.closed.now': 'Closed now', 'exits.opens': 'Opens {time}',
  'exits.nearest': 'Nearest exit: {name}', 'exits.walk': '{min} min walk',
});
Object.assign(DICT.ja, {
  'exits': '出口', 'exits.n': '{n}か所', 'exits.more': 'すべて表示（{n}）', 'exits.less': '閉じる',
  'exits.show': '{name}を地図で表示', 'exits.missing': '{ops}の出口データはありません。',
  'exits.f.stairs': '階段', 'exits.f.escalator': 'エスカレーター', 'exits.f.elevator': 'エレベーター', 'exits.f.ramp': 'スロープ',
  'exits.closed': '閉鎖', 'exits.closed.today': '本日閉鎖', 'exits.closed.now': '時間外', 'exits.opens': '{time}から',
  'exits.nearest': '最寄りの出口: {name}', 'exits.walk': '徒歩{min}分',
});
Object.assign(DICT.id, {
  'exits': 'Pintu keluar', 'exits.n': '{n} pintu keluar', 'exits.more': 'Tampilkan semua {n}', 'exits.less': 'Tampilkan lebih sedikit',
  'exits.show': '{name}: tampilkan di peta', 'exits.missing': 'Tidak ada data pintu keluar untuk {ops}.',
  'exits.f.stairs': 'Tangga', 'exits.f.escalator': 'Eskalator', 'exits.f.elevator': 'Lift', 'exits.f.ramp': 'Jalur landai',
  'exits.closed': 'Tutup', 'exits.closed.today': 'Tutup hari ini', 'exits.closed.now': 'Sedang tutup', 'exits.opens': 'Buka {time}',
  'exits.nearest': 'Pintu keluar terdekat: {name}', 'exits.walk': 'Jalan kaki {min} mnt',
});
// (end of exits.js keys)

// the offline work keys
Object.assign(DICT.en, {
  'offline.note': 'Offline · timetable view',
  'offline.aria': 'No connection: the map, trains and boards run from the timetable saved on this phone',
});
Object.assign(DICT.ja, {
  'offline.note': 'オフライン · 時刻表どおり',
  'offline.aria': '接続がありません。地図・列車・発車案内は、この端末に保存した時刻表で表示しています',
});
Object.assign(DICT.id, {
  'offline.note': 'Offline · menurut jadwal',
  'offline.aria': 'Tidak ada koneksi: peta, kereta, dan papan memakai jadwal yang tersimpan di ponsel ini',
});
// (end of the offline work keys)

// playback.js keys
Object.assign(DICT.en, {
  'pb.chip.live': '{time} WIB', 'pb.chip': 'Playback {time}',
  'pb.chip.aria': '{time} WIB. Watch the trains at another time today',
  'pb.chip.aria.pb': 'Playback {time}. Change the time or go back to now',
  'pb.eye.live': 'Now', 'pb.eye': 'Playback', 'pb.eyebrow': 'Playback · {time} WIB',
  'pb.playing': 'Playing at {n}×', 'pb.paused': 'Paused', 'pb.end': 'End of today’s timetable', 'pb.live': 'Following the clock',
  'pb.loading': 'Getting the timetable for {time}…',
  'pb.slider': 'Time of day', 'pb.speed': 'Speed', 'pb.speed.n': '{n}× speed', 'pb.play': 'Play', 'pb.pause': 'Pause',
  'pb.back': 'Back to now', 'pb.hint': 'Any time of today’s timetable, 03:00 to 03:00.',
  'pb.ops': 'Running at {time}, by operator', 'pb.none': 'No trains running at {time}',
});
Object.assign(DICT.ja, {
  'pb.chip.live': '{time}', 'pb.chip': '再生 {time}',
  'pb.chip.aria': '{time}。今日のほかの時刻の列車を見る',
  'pb.chip.aria.pb': '再生 {time}。時刻を変える、または現在に戻る',
  'pb.eye.live': '現在', 'pb.eye': '再生', 'pb.eyebrow': '再生 · {time}',
  'pb.playing': '{n}倍速で再生中', 'pb.paused': '一時停止中', 'pb.end': '本日の時刻表はここまでです', 'pb.live': '現在の時刻で表示中',
  'pb.loading': '{time}の時刻表を読み込み中…',
  'pb.slider': '時刻', 'pb.speed': '再生速度', 'pb.speed.n': '{n}倍速', 'pb.play': '再生', 'pb.pause': '一時停止',
  'pb.back': '現在に戻る', 'pb.hint': '本日の時刻表の好きな時刻を表示できます（3:00〜翌3:00）。',
  'pb.ops': '{time}に運行中の列車（事業者別）', 'pb.none': '{time}に運行中の列車はありません',
});
Object.assign(DICT.id, {
  'pb.chip.live': '{time} WIB', 'pb.chip': 'Pemutaran {time}',
  'pb.chip.aria': '{time} WIB. Lihat kereta di jam lain hari ini',
  'pb.chip.aria.pb': 'Pemutaran {time}. Ganti jam atau kembali ke sekarang',
  'pb.eye.live': 'Sekarang', 'pb.eye': 'Pemutaran', 'pb.eyebrow': 'Pemutaran · {time} WIB',
  'pb.playing': 'Diputar {n}×', 'pb.paused': 'Dijeda', 'pb.end': 'Jadwal hari ini sudah habis', 'pb.live': 'Mengikuti jam sekarang',
  'pb.loading': 'Mengambil jadwal pukul {time}…',
  'pb.slider': 'Jam', 'pb.speed': 'Kecepatan', 'pb.speed.n': 'Kecepatan {n}×', 'pb.play': 'Putar', 'pb.pause': 'Jeda',
  'pb.back': 'Kembali ke sekarang', 'pb.hint': 'Pilih jam berapa pun dalam jadwal hari ini, pukul 03.00 sampai 03.00 besok.',
  'pb.ops': 'Pukul {time}, per operator', 'pb.none': 'Tidak ada kereta yang jalan pukul {time}',
});
// (end of playback.js keys)

// nearby.js keys (nearby.js 'nb.*', the "Trains near me" block on the home; also reads board.js's board.for /
// board.toward / board.then / board.gone / board.first.next / board.last / board.with and live.js's live.* keys)
Object.assign(DICT.en, {
  'nb.title': 'Trains near me', 'nb.go': 'Trains near me',
  'nb.priv': 'Your location stays on this phone.', 'nb.stop': 'Turn off',
  'nb.wait': 'Finding stations near you…', 'nb.wait.sub': 'Your browser may ask to use your location.',
  'nb.denied': 'Location is off for this site.', 'nb.denied.sub': 'Pick your station instead, or allow location for this site in your browser settings.',
  'nb.nogeo': 'This browser cannot share your location.', 'nb.unavail': 'Your location could not be read just now.',
  'nb.pick.sub': 'Pick your station to see its next trains.', 'nb.far': 'No stations within {km} km of you.',
  'nb.walk': '{min} min walk', 'nb.exit': 'Nearest exit: {name}', 'nb.more': 'All {n} lines at {name}',
  'nb.board': 'Open the station board', 'nb.acc': 'Location ± {dist}',
});
Object.assign(DICT.ja, {
  'nb.title': '近くの電車', 'nb.go': '近くの電車を見る',
  'nb.priv': '現在地はこの端末の外に送信されません。', 'nb.stop': 'オフにする',
  'nb.wait': '近くの駅を探しています…', 'nb.wait.sub': 'ブラウザが位置情報の利用を確認することがあります。',
  'nb.denied': 'このサイトの位置情報がオフです。', 'nb.denied.sub': '駅を選ぶか、ブラウザの設定でこのサイトの位置情報を許可してください。',
  'nb.nogeo': 'このブラウザでは位置情報を使えません。', 'nb.unavail': '現在地を取得できませんでした。',
  'nb.pick.sub': '駅を選ぶと、次の電車が見られます。', 'nb.far': '{km} km以内に駅がありません。',
  'nb.walk': '徒歩{min}分', 'nb.exit': '最寄りの出口: {name}', 'nb.more': '{name}駅の全{n}路線',
  'nb.board': '駅の発車案内を開く', 'nb.acc': '位置の誤差 ±{dist}',
});
Object.assign(DICT.id, {
  'nb.title': 'Kereta di dekatku', 'nb.go': 'Kereta di dekatku',
  'nb.priv': 'Lokasimu tetap di ponsel ini.', 'nb.stop': 'Matikan',
  'nb.wait': 'Mencari stasiun di dekatmu…', 'nb.wait.sub': 'Browser mungkin meminta izin memakai lokasimu.',
  'nb.denied': 'Akses lokasi untuk situs ini nonaktif.', 'nb.denied.sub': 'Pilih stasiunmu saja, atau izinkan lokasi untuk situs ini di pengaturan browser.',
  'nb.nogeo': 'Browser ini tidak bisa membagikan lokasimu.', 'nb.unavail': 'Lokasimu belum bisa dibaca.',
  'nb.pick.sub': 'Pilih stasiunmu untuk melihat kereta berikutnya.', 'nb.far': 'Tidak ada stasiun dalam radius {km} km dari lokasimu.',
  'nb.walk': 'Jalan kaki {min} mnt', 'nb.exit': 'Pintu keluar terdekat: {name}', 'nb.more': 'Semua {n} jalur di {name}',
  'nb.board': 'Buka papan keberangkatan stasiun', 'nb.acc': 'Akurasi lokasi ± {dist}',
});
// (end of nearby.js keys)

// the bus layer keys (web/src/tokyo/buses/ 'bus.*': the Buses button, the bus sheet; view.js BUS_TEXT is the same
// table as a fallback, these win; copy reviewed 3 Nov 2026)
Object.assign(DICT.en, {
  'bus.chip': 'Buses',
  'bus.chip.aria': 'Show live buses',
  'bus.op': 'Toei Bus',
  'bus.vehicle': 'bus {id}',
  'bus.for': 'For {name}',
  'bus.live': 'Live position · as of {time}',
  'bus.stale': 'Last report {n} min ago ({time})',
  'bus.next': 'Next stops',
  'bus.now': 'now',
  'bus.more': '+{n} more stops to {name}',
  'bus.terminus': 'Terminus',
  'bus.note': 'Toei Bus reports each bus at its stops. Between reports the bus is drawn rolling on toward its next stop, never past it.',
  'bus.note.gps': 'This operator sends each bus’s GPS position. Between reports the bus is drawn moving along its route, never past its next stop.',
  'bus.gone': 'This bus is no longer in the live feed.',
  'bus.loading': 'Loading live buses…',
  'bus.count': '{n} buses live',
  'bus.nostops': 'No stop list for this trip.',
  'bus.list': 'Buses near the map centre',
  'bus.list.sub': 'Live positions',
  'bus.list.next': 'next {name}',
  'bus.credit': 'Toei Bus data: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation (CC BY 4.0, modified). Accuracy not guaranteed; please do not contact the operator about this app.',
  'bus.credit.other': 'Bus data: {provider}, via the Public Transportation Open Data Center (CC BY 4.0, modified). Accuracy not guaranteed; please do not contact the operator about this app.',
});
Object.assign(DICT.ja, {
  'bus.chip': 'バス',
  'bus.chip.aria': 'バスをリアルタイムで表示',
  'bus.op': '都営バス',
  'bus.vehicle': '車両 {id}',
  'bus.for': '{name}行',
  'bus.live': '実際の位置 · {time}時点',
  'bus.stale': '{n}分前の情報（{time}）',
  'bus.next': '次の停留所',
  'bus.now': '停車中',
  'bus.more': '{name}まであと{n}停留所',
  'bus.terminus': '終点',
  'bus.note': '都営バスは停留所ごとに位置を送ります。停留所の間は次の停留所へ向かう位置を描いており、次の停留所より先には進みません。',
  'bus.note.gps': 'この事業者は各バスのGPS位置を送ります。報告の間は路線に沿って動く位置を描いており、次の停留所より先には進みません。',
  'bus.gone': 'このバスはリアルタイム情報から外れました。',
  'bus.loading': 'バスを読み込み中…',
  'bus.count': 'リアルタイムのバス {n}台',
  'bus.nostops': 'この便の停留所一覧はありません。',
  'bus.list': '地図の中心に近いバス',
  'bus.list.sub': 'リアルタイム',
  'bus.list.next': '次は{name}',
  'bus.credit': '都営バスのデータ：東京都交通局・公共交通オープンデータ協議会（CC BY 4.0、加工して利用）。データの正確性は保証されません。本アプリについて事業者へのお問い合わせはご遠慮ください。',
  'bus.credit.other': 'バスのデータ：{provider}（公共交通オープンデータセンター経由、CC BY 4.0、加工して利用）。データの正確性は保証されません。本アプリについて事業者へのお問い合わせはご遠慮ください。',
});
Object.assign(DICT.id, {
  'bus.chip': 'Bus',
  'bus.chip.aria': 'Tampilkan posisi langsung bus',
  'bus.op': 'Bus Toei',
  'bus.vehicle': 'nomor bus {id}',
  'bus.for': 'Ke {name}',
  'bus.live': 'Posisi langsung · per {time}',
  'bus.stale': 'Laporan terakhir {n} mnt lalu ({time})',
  'bus.next': 'Halte berikutnya',
  'bus.now': 'sekarang',
  'bus.more': '+{n} halte lagi sampai {name}',
  'bus.terminus': 'Halte terakhir',
  'bus.note': 'Bus Toei melaporkan posisi tiap bus di halte. Di antara laporan, bus digambar bergerak ke halte berikutnya, tidak pernah melewatinya.',
  'bus.note.gps': 'Operator ini mengirim posisi GPS tiap bus. Di antara laporan, bus digambar bergerak di sepanjang rutenya, tidak pernah melewati halte berikutnya.',
  'bus.gone': 'Bus ini sudah tidak ada di data langsung.',
  'bus.loading': 'Memuat posisi bus…',
  'bus.count': 'Posisi langsung {n} bus',
  'bus.nostops': 'Tidak ada daftar halte untuk perjalanan ini.',
  'bus.list': 'Bus di dekat tengah peta',
  'bus.list.sub': 'Posisi langsung',
  'bus.list.next': 'berikutnya {name}',
  'bus.credit': 'Data Bus Toei: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation (CC BY 4.0, diubah). Akurasi tidak dijamin; mohon jangan menghubungi operator tentang aplikasi ini.',
  'bus.credit.other': 'Data bus: {provider}, lewat Public Transportation Open Data Center (CC BY 4.0, diubah). Akurasi tidak dijamin; mohon jangan menghubungi operator tentang aplikasi ini.',
});
// (end of the bus layer keys)

// coverage.js keys (coverage.js 'cov.*', the "Live now" sheet opened from the Live/Scheduled pill; also reads
// page.js's close / data.loading / sched / pill.est / about.data and train-view.js's tv.live. Never names a data source.)
Object.assign(DICT.en, {
  'cov.title': 'Live positions', 'cov.sub': '{n} of {total} lines live now', 'cov.sub.none': 'No live positions right now',
  'cov.none': 'Every train is shown by the timetable.',
  'cov.pb': 'Playback shows every train by the timetable.',
  'cov.g.live': 'Live now', 'cov.g.est': 'Estimated', 'cov.g.tt': 'Timetable only',
  'cov.n.lines': '{n} lines', 'cov.n.lines.one': '{n} line',
  'cov.running': '{n} running now', 'cov.est.n': '{n} estimated', 'cov.w.live': 'live', 'cov.w.est': 'estimated',
  'cov.from': 'From {line} · last report {time}', 'cov.from.only': 'From {line}', 'cov.last': 'Last report {time}',
  'cov.asof': 'as of {time}', 'cov.show': 'Show {n} lines', 'cov.hide': 'Hide the lines',
  'cov.k.live': 'the train is shown where it was reported moments ago, with its delay.',
  'cov.k.est': 'the delay from the train’s last report, carried on for up to 20 minutes (also after it runs on to another line).',
  'cov.k.tt': 'the train is shown where the timetable puts it.',
});
Object.assign(DICT.ja, {
  'cov.title': 'リアルタイム表示の路線', 'cov.sub': '全{total}路線のうち{n}路線', 'cov.sub.none': '現在リアルタイム表示の路線はありません',
  'cov.none': 'すべての列車を時刻表どおりに表示しています。',
  'cov.pb': '再生中は、すべての列車を時刻表どおりに表示します。',
  'cov.g.live': 'リアルタイム表示中', 'cov.g.est': '推定', 'cov.g.tt': '時刻表のみ',
  'cov.n.lines': '{n}路線',
  'cov.running': '運行中{n}本', 'cov.est.n': '推定{n}本', 'cov.w.live': 'リアルタイム', 'cov.w.est': '推定',
  'cov.from': '{line}から直通 · {time}の情報', 'cov.from.only': '{line}から直通', 'cov.last': '{time}の情報',
  'cov.asof': '{time}時点', 'cov.show': '{n}路線を表示', 'cov.hide': '路線を隠す',
  'cov.k.live': '直前に報告された位置と遅れで表示しています。',
  'cov.k.est': '列車の最後の報告の遅れを、最長20分引き継いで表示しています（他の路線へ直通した後も）。',
  'cov.k.tt': '時刻表で決まっている位置に表示しています。',
});
Object.assign(DICT.id, {
  'cov.title': 'Posisi langsung', 'cov.sub': '{n} dari {total} jalur tampil langsung', 'cov.sub.none': 'Belum ada posisi langsung saat ini',
  'cov.none': 'Semua kereta tampil menurut jadwal.',
  'cov.pb': 'Saat pemutaran, semua kereta tampil menurut jadwal.',
  'cov.g.live': 'Langsung sekarang', 'cov.g.est': 'Perkiraan', 'cov.g.tt': 'Hanya jadwal',
  'cov.n.lines': '{n} jalur',
  'cov.running': '{n} kereta jalan sekarang', 'cov.est.n': '{n} perkiraan', 'cov.w.live': 'langsung', 'cov.w.est': 'perkiraan',
  'cov.from': 'Dari {line} · laporan terakhir {time}', 'cov.from.only': 'Dari {line}', 'cov.last': 'Laporan terakhir {time}',
  'cov.asof': 'per {time}', 'cov.show': 'Tampilkan {n} jalur', 'cov.hide': 'Sembunyikan jalur',
  'cov.k.live': 'kereta tampil di posisi yang baru saja dilaporkan, dengan keterlambatannya.',
  'cov.k.est': 'keterlambatan dari laporan terakhir kereta dibawa sampai 20 menit (juga setelah kereta lanjut ke jalur lain).',
  'cov.k.tt': 'kereta tampil di posisi menurut jadwalnya.',
});
// (end of coverage.js keys)

// the live count keys (the live count in the home headline, the Live chip, the map pill "● Live · 281"; page.js +
// views.js 'lvis.*'. Term sheet: Live position / リアルタイム (pill) / Posisi langsung. Never names a source.)
Object.assign(DICT.en, {
  'lvis.head': '{n} live', 'lvis.rest': 'the rest scheduled', 'lvis.head.aria': '{n} live, the rest scheduled. See which lines are live',
  'lvis.only': 'with a live position', 'lvis.only.aria': '{n} trains with a live position. See which lines',
  'lvis.chip': 'Live',
  'lvis.pill': 'Live · {n}', 'lvis.pill.aria': 'Live · {n}: trains with a live position now. See which lines',
  'lvis.say.on': 'The map shows only the {n} trains with a live position', 'lvis.say.off': 'The map shows every train',
});
Object.assign(DICT.ja, {
  'lvis.head': 'リアルタイム{n}本', 'lvis.rest': 'ほかは時刻表どおり', 'lvis.head.aria': 'リアルタイム{n}本、ほかは時刻表どおり。リアルタイムの路線を見る',
  'lvis.only': 'リアルタイム表示中', 'lvis.only.aria': 'リアルタイム表示中の{n}本。路線を見る',
  'lvis.chip': 'リアルタイム',
  'lvis.pill': 'リアルタイム · {n}本', 'lvis.pill.aria': 'リアルタイム · {n}本：実際の位置がわかる列車。路線を見る',
  'lvis.say.on': '地図にはリアルタイムの{n}本だけを表示しています', 'lvis.say.off': '地図にすべての列車を表示しています',
});
Object.assign(DICT.id, {
  'lvis.head': '{n} posisi langsung', 'lvis.rest': 'lainnya menurut jadwal', 'lvis.head.aria': '{n} posisi langsung, lainnya menurut jadwal. Lihat jalur yang langsung',
  'lvis.only': 'dengan posisi langsung', 'lvis.only.aria': '{n} kereta dengan posisi langsung. Lihat jalurnya',
  'lvis.chip': 'Posisi langsung',
  'lvis.pill': 'Posisi langsung · {n}', 'lvis.pill.aria': 'Posisi langsung · {n}: kereta dengan posisi langsung sekarang. Lihat jalurnya',
  'lvis.say.on': 'Peta hanya menampilkan {n} kereta dengan posisi langsung', 'lvis.say.off': 'Peta menampilkan semua kereta',
});
// (end of the live count keys)

// the underground view keys (page.js toggleUnderground / ugStationAct; city3d draws depth 5x so the levels separate;
// city3d.ug.zoomin = the calm note when the underground is on but the map is zoomed out past z12.5)
Object.assign(DICT.en, {
  'city3d.see': 'See it underground',
  'city3d.ug.toast': 'Underground: subway tunnels at their depth (drawn 5× deeper). Green ring = live position.',
  'city3d.ug.zoomin': 'Zoom in to see the underground',
  'city3d.ug.true': 'True scale', 'city3d.ug.ride': 'Ride a train', 'city3d.ug.stop': 'Stop riding',
  'city3d.ug.ridenone': 'No subway train in view', 'city3d.ug.ridetrain': 'Ride in the tunnel',
  'city3d.ug.behind': 'Behind', 'city3d.ug.cab': 'Cab',
});
Object.assign(DICT.ja, {
  'city3d.see': '地下で見る',
  'city3d.ug.toast': '地下: 地下鉄のトンネルを深さどおりに表示（深さは5倍で描画）。緑の輪 = リアルタイム位置',
  'city3d.ug.zoomin': '地下を見るには拡大してください',
  'city3d.ug.true': '実寸', 'city3d.ug.ride': '電車に乗る', 'city3d.ug.stop': '乗るのをやめる',
  'city3d.ug.ridenone': '近くに地下鉄の電車がありません', 'city3d.ug.ridetrain': 'トンネルを乗って見る',
  'city3d.ug.behind': '後ろから', 'city3d.ug.cab': '運転席',
});
Object.assign(DICT.id, {
  'city3d.see': 'Lihat di bawah tanah',
  'city3d.ug.toast': 'Bawah tanah: terowongan kereta bawah tanah di kedalamannya (digambar 5× lebih dalam). Cincin hijau = posisi langsung.',
  'city3d.ug.zoomin': 'Perbesar peta untuk melihat bawah tanah',
  'city3d.ug.true': 'Skala asli', 'city3d.ug.ride': 'Ikut kereta', 'city3d.ug.stop': 'Berhenti ikut',
  'city3d.ug.ridenone': 'Tidak ada kereta bawah tanah di sini', 'city3d.ug.ridetrain': 'Ikut di terowongan',
  'city3d.ug.behind': 'Dari belakang', 'city3d.ug.cab': 'Kabin',
});
// (end of the underground view keys)

// RESET keys (reset.js, the map card's Reset view button = the opening view again; reset.say = the
// polite line after a tap)
Object.assign(DICT.en, {
  'reset.view': 'Reset view',
  'reset.say': 'Back to the opening view',
});
Object.assign(DICT.ja, {
  'reset.view': '表示をリセット',
  'reset.say': '最初の表示に戻しました',
});
Object.assign(DICT.id, {
  'reset.view': 'Atur ulang tampilan',
  'reset.say': 'Kembali ke tampilan awal',
});
// (end of RESET keys)

// (end of other lanes' keys)

// ------------------------------------------------------------------ language
const okLang = (l) => (l === 'en' || l === 'ja' || l === 'id' ? l : null);
export function detect(navLang = typeof navigator !== 'undefined' ? (navigator.languages && navigator.languages[0]) || navigator.language : '') {
  const l = String(navLang || '').toLowerCase();
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('en')) return 'en';
  return 'id';   // aplikasi Jakarta: bahasa Indonesia sebagai bawaan
}
function stored() {
  try { return okLang(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function fromUrl() {
  try { return okLang(new URLSearchParams(location.search).get('lang')); } catch { return null; }
}
// stored does its own try: with site data blocked even `typeof localStorage` throws
let cur = (typeof location !== 'undefined' && fromUrl()) || stored() || detect();
const listeners = new Set();

export const lang = () => cur;
export const locale = () => LOCALE[cur];
/** Switch language (kept in this browser only); listeners re-render. */
export function setLang(l, { save = true } = {}) {
  const next = okLang(l);
  if (!next || next === cur) return;
  cur = next;
  if (save) { try { localStorage.setItem(STORE_KEY, next); } catch { /* storage blocked: this visit only */ } }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const fn of listeners) { try { fn(next); } catch (e) { console.warn('[i18n] listener', e); } }
}
export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ------------------------------------------------------------------ strings
const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : String(s));
/** The string for key in the current language (falls back to EN, then the key). Plain text: escape before HTML. */
const missing = new Set();        // keys asked for that no language has (QA: window.__tokyo.i18n())
const untranslated = new Set();   // 'ja:key' / 'id:key' that fell back to EN
export function t(key, vars) {
  let s = DICT[cur]?.[key];
  if (s == null) {
    s = DICT.en[key];
    if (s == null) { missing.add(key); s = key; } else if (cur !== 'en') untranslated.add(`${cur}:${key}`);
  }
  return fill(s, vars);
}
/** QA: keys the page asked for that are missing ({missing: [...], untranslated: ['ja:key', ...]}). */
export const report = () => ({ missing: [...missing], untranslated: [...untranslated] });
/** Counted string: EN uses `<key>.one` for 1; {n} is formatted with the language's digits grouping. */
export function tn(key, n, vars = {}) {
  const k = n === 1 && (DICT[cur]?.[`${key}.one`] ?? (cur === 'en' ? DICT.en[`${key}.one`] : null)) ? `${key}.one` : key;
  return t(k, { ...vars, n: fmtNum(n) });
}
export const has = (key) => key in (DICT[cur] || {}) || key in DICT.en;

/** A station / line / type title {en, ja} (MT3D) in the current language; ID uses `en`. */
export function title(obj, l = cur) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return l === 'ja' ? obj.ja || obj.en || '' : obj.en || obj.ja || '';
}
/** The other language's title (shown small under the main one: EN/ID screens show the kanji, JA shows the romaji). */
export function titleAlt(obj, l = cur) {
  if (!obj || typeof obj === 'string') return '';
  const alt = l === 'ja' ? obj.en : obj.ja;
  return alt && alt !== title(obj, l) ? alt : '';
}

export function fmtNum(n) {
  try { return new Intl.NumberFormat(LOCALE[cur]).format(n); } catch { return String(n); }
}
/** "16:58" from seconds since 00:00 WIB of the service day (>= 86400 after midnight wraps). */
export function clock(sec) {
  if (!Number.isFinite(sec)) return '–';
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const sep = cur === 'id' ? '.' : ':';   // Indonesian writes 05.30 (trafik.live's own pages), EN / JA 05:30
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}${sep}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}
/** Wall clock in WIB for a ms timestamp: "16:58". */
export function clockMs(ms) { return clock(Math.floor(ms / 1000) + 7 * 3600); }

/** Add or override keys at runtime (a lane's own strings), e.g. extend({ en: {...}, ja: {...}, id: {...} }). */
export function extend(dicts) {
  for (const [l, d] of Object.entries(dicts || {})) if (DICT[l]) Object.assign(DICT[l], d);
}

/** Apply the current language to static markup: [data-i18n] text, [data-i18n-aria] aria-label, [data-i18n-ph] placeholder. */
export function applyDom(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', t(el.dataset.i18nPh));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
  if (root.documentElement) root.documentElement.lang = cur;
}

export { DICT as _dict };
