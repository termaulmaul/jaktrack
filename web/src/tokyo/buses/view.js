// Buses: the bus sheet (HTML string, like the other views) + its words in EN / JA / ID.
// The page passes its own t() (i18n.js, `// the bus layer keys` block, which wins); BUS_TEXT is the same table, used when a key
// is missing (tests, a page without the block). Copy reviewed 3 Nov 2026; the sheet speaks the page's sheet
// language (the shared.ph head,.sech headings, tokens, 13 px floor).

export const BUS_TEXT = {
  en: {
    'bus.chip': 'Buses', 'bus.chip.aria': 'Show live buses', 'bus.op': 'Toei Bus', 'bus.vehicle': 'bus {id}',
    'bus.for': 'For {name}', 'bus.live': 'Live position · as of {time}', 'bus.stale': 'Last report {n} min ago ({time})',
    'bus.next': 'Next stops', 'bus.now': 'now', 'bus.more': '+{n} more stops to {name}', 'bus.terminus': 'Terminus',
    'bus.note': 'Toei Bus reports each bus at its stops. Between reports the bus is drawn rolling on toward its next stop, never past it.',
    'bus.note.gps': 'This operator sends each bus’s GPS position. Between reports the bus is drawn moving along its route, never past its next stop.',
    'bus.gone': 'This bus is no longer in the live feed.', 'bus.loading': 'Loading live buses…', 'bus.count': '{n} buses live',
    'bus.nostops': 'No stop list for this trip.',
    'bus.list': 'Buses near the map centre', 'bus.list.sub': 'Live positions', 'bus.list.next': 'next {name}',
    'bus.credit': 'Toei Bus data: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation (CC BY 4.0, modified). Accuracy not guaranteed; please do not contact the operator about this app.',
    'bus.credit.other': 'Bus data: {provider}, via the Public Transportation Open Data Center (CC BY 4.0, modified). Accuracy not guaranteed; please do not contact the operator about this app.',
  },
  ja: {
    'bus.chip': 'バス', 'bus.chip.aria': 'バスをリアルタイムで表示', 'bus.op': '都営バス', 'bus.vehicle': '車両 {id}',
    'bus.for': '{name}行', 'bus.live': '実際の位置 · {time}時点', 'bus.stale': '{n}分前の情報（{time}）',
    'bus.next': '次の停留所', 'bus.now': '停車中', 'bus.more': '{name}まであと{n}停留所', 'bus.terminus': '終点',
    'bus.note': '都営バスは停留所ごとに位置を送ります。停留所の間は次の停留所へ向かう位置を描いており、次の停留所より先には進みません。',
    'bus.note.gps': 'この事業者は各バスのGPS位置を送ります。報告の間は路線に沿って動く位置を描いており、次の停留所より先には進みません。',
    'bus.gone': 'このバスはリアルタイム情報から外れました。', 'bus.loading': 'バスを読み込み中…', 'bus.count': 'リアルタイムのバス {n}台',
    'bus.nostops': 'この便の停留所一覧はありません。',
    'bus.list': '地図の中心に近いバス', 'bus.list.sub': 'リアルタイム', 'bus.list.next': '次は{name}',
    'bus.credit': '都営バスのデータ：東京都交通局・公共交通オープンデータ協議会（CC BY 4.0、加工して利用）。データの正確性は保証されません。本アプリについて事業者へのお問い合わせはご遠慮ください。',
    'bus.credit.other': 'バスのデータ：{provider}（公共交通オープンデータセンター経由、CC BY 4.0、加工して利用）。データの正確性は保証されません。本アプリについて事業者へのお問い合わせはご遠慮ください。',
  },
  id: {
    'bus.chip': 'Bus', 'bus.chip.aria': 'Tampilkan posisi langsung bus', 'bus.op': 'Bus Toei', 'bus.vehicle': 'nomor bus {id}',
    'bus.for': 'Ke {name}', 'bus.live': 'Posisi langsung · per {time}', 'bus.stale': 'Laporan terakhir {n} mnt lalu ({time})',
    'bus.next': 'Halte berikutnya', 'bus.now': 'sekarang', 'bus.more': '+{n} halte lagi sampai {name}', 'bus.terminus': 'Halte terakhir',
    'bus.note': 'Bus Toei melaporkan posisi tiap bus di halte. Di antara laporan, bus digambar bergerak ke halte berikutnya, tidak pernah melewatinya.',
    'bus.note.gps': 'Operator ini mengirim posisi GPS tiap bus. Di antara laporan, bus digambar bergerak di sepanjang rutenya, tidak pernah melewati halte berikutnya.',
    'bus.gone': 'Bus ini sudah tidak ada di data langsung.', 'bus.loading': 'Memuat posisi bus…', 'bus.count': 'Posisi langsung {n} bus',
    'bus.nostops': 'Tidak ada daftar halte untuk perjalanan ini.',
    'bus.list': 'Bus di dekat tengah peta', 'bus.list.sub': 'Posisi langsung', 'bus.list.next': 'berikutnya {name}',
    'bus.credit': 'Data Bus Toei: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation (CC BY 4.0, diubah). Akurasi tidak dijamin; mohon jangan menghubungi operator tentang aplikasi ini.',
    'bus.credit.other': 'Data bus: {provider}, lewat Public Transportation Open Data Center (CC BY 4.0, diubah). Akurasi tidak dijamin; mohon jangan menghubungi operator tentang aplikasi ini.',
  },
};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** t(key, vars) for the bus words: the page's t when it knows the key, else BUS_TEXT. */
export function busT(lang, pageT) {
  const L = BUS_TEXT[lang] ? lang : 'en';
  return (key, vars) => {
    let s = null;
    if (typeof pageT === 'function') { try { const v = pageT(key, vars); if (v && v !== key) s = v; } catch { /* fall back */ } }
    if (s == null) {
      s = BUS_TEXT[L][key] ?? BUS_TEXT.en[key] ?? key;
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    }
    return s;
  };
}

const WIB = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
export const clockJst = (ms) => (Number.isFinite(ms) ? WIB.format(new Date(ms)) : '');
/** The WIB clock as the page writes it in `lang`: Indonesian 17.40 (i18n.js clock()), EN / JA 17:40. */
export const clockFor = (ms, lang) => { const s = clockJst(ms); return lang === 'id' ? s.replace(':', '.') : s; };

/** Name in the page language (JA -> ja, EN / ID -> en) + the other one as a small alt. */
const nameOf = (o, lang) => (lang === 'ja' ? o.ja : o.en || o.ja);
const altOf = (o, lang) => { const a = lang === 'ja' ? o.en : o.ja; return a && a !== nameOf(o, lang) ? a : ''; };
const NON_ASCII = /[^\x20-\x7E]/;

/**
 * The bus sheet. info = api.info(id) (index.js): { id, route, op, head, next: [{name, now}], more, last, reportAt, stale }.
 * ctx: { lang, t (page's i18n t), now, close (desktop: the close button in the head, like the train / line views),
 * loading }. Returns an HTML string (no handlers: the close button is the page's data-act="back").
 */
export function busSheetHtml(info, ctx = {}) {
  const lang = ctx.lang || 'en';
  const t = busT(lang, ctx.t);
  const esc = escHtml;
  const alt = lang === 'ja' ? 'en' : 'ja';
  const close = ctx.close ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(t('close'))}"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button>` : '';
  // ctx.loading: buses just switched on, the first live answer not in yet (a cold #b= link)
  if (!info) {
    return `<section class="tkb">${close ? `<div class="ph" data-drag><div class="rt"></div>${close}</div>` : ''}<p class="tkb-note">${esc(t(ctx.loading ? 'bus.loading' : 'bus.gone'))}</p><p class="tkb-credit">${esc(t('bus.credit'))}</p></section>`;
  }
  const r = info.route;
  const op = info.op || null;   // { id, name: {ja, en}, stopReports } (pack.js); none = Toei (older packs)
  const tag = r ? r.tag.ja : '';
  const roman = r && lang !== 'ja' && r.tag.en && r.tag.en !== r.tag.ja ? r.tag.en : '';
  const head = info.head && (info.head.ja || info.head.en) ? info.head : null;
  const title = head ? t('bus.for', { name: nameOf(head, lang) }) : (r ? tag : t('bus.op'));
  const headAlt = head ? altOf(head, lang) : '';
  const now = ctx.now ?? Date.now();
  const ageMin = Math.max(0, Math.round((now - info.reportAt) / 60000));
  const time = clockFor(info.reportAt, lang);
  const liveLine = info.stale ? t('bus.stale', { n: ageMin, time }) : t('bus.live', { time });
  const opName = op ? (lang === 'ja' ? op.name.ja : op.name.en || op.name.ja) : t('bus.op');
  const sub = [roman, opName, t('bus.vehicle', { id: String(info.id).replace(/^[a-z]+:/, '') })].filter(Boolean).join(' · ');
  const note = op && !op.stopReports ? t('bus.note.gps') : t('bus.note');
  // another feed: its own bus.credit.<id> key when there is one, else the CC BY credit built from its provider name
  const own = op && op.id !== 'toei' ? t(`bus.credit.${op.id}`) : null;
  const provider = op ? (lang === 'ja' ? op.provider?.ja || op.name.ja : op.provider?.en || op.name.en || op.name.ja) : '';
  const credit = !op || op.id === 'toei' ? t('bus.credit') : own && own !== `bus.credit.${op.id}` ? own : t('bus.credit.other', { provider });
  let stops = '';
  if (info.next && info.next.length) {
    stops = `<div class="sech"><h2>${esc(t('bus.next'))}</h2></div><ol class="tkb-stops">${info.next.map((s, i) => {
      const a = altOf(s.name, lang);
      const last = i === info.next.length - 1 && !info.more;
      return `<li class="${s.now ? 'now' : ''}${last ? ' end' : ''}"><i aria-hidden="true"></i><span><b>${esc(nameOf(s.name, lang))}</b>${a ? `<small lang="${alt}">${esc(a)}</small>` : ''}</span>${s.now ? `<em>${esc(t('bus.now'))}</em>` : last ? `<em>${esc(t('bus.terminus'))}</em>` : ''}</li>`;
    }).join('')}</ol>${info.more ? `<p class="tkb-more">${esc(t('bus.more', { n: info.more, name: nameOf(info.last.name, lang) }))}</p>` : ''}`;
  } else stops = `<p class="tkb-note">${esc(t('bus.nostops'))}</p>`;
  const lead = `<span class="tkb-tag"><b${NON_ASCII.test(tag) ? ' lang="ja"' : ''}>${esc(tag || '·')}</b></span>`;
  const p = `${headAlt ? `<span lang="${alt}">${esc(headAlt)}</span> · ` : ''}${esc(sub)}`;
  return `<section class="tkb" data-bus="${esc(info.id)}" style="--rc:${esc(r ? r.color : '#6B6B70')}">
  <div class="ph" data-drag>${lead}<div class="rt"><h2>${esc(title)}</h2><p>${p}</p></div>${close}</div>
  <p class="tkb-live${info.stale ? ' stale' : ''}"><span class="tkb-dot" aria-hidden="true"></span>${esc(liveLine)}</p>
  ${stops}
  <p class="tkb-note">${esc(note)}</p>
  <p class="tkb-credit">${esc(credit)}</p>
</section>`;
}

/** Metres as the page writes them: '120 m', '1.2 km' (ID '1,2 km'). */
const distText = (d, lang) => (d < 1000 ? `${Math.max(10, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1).replace('.', lang === 'id' ? ',' : '.')} km`);

/**
 * Rows for the list of buses near the map centre (the map's buses are WebGL only, so keyboard and screen-reader
 * users get them here): one button per bus, data-bus = its id (the home's click opens the bus sheet, as a map tap does).
 * list = api.near() items (info(id) + d metres). ctx: { lang, t, now }.
 */
export function busRowsHtml(list, ctx = {}) {
  const lang = ctx.lang || 'en';
  const t = busT(lang, ctx.t);
  const esc = escHtml;
  const now = ctx.now ?? Date.now();
  return (list || []).map((x) => {
    const r = x.route, tag = r ? r.tag.ja : '';
    const head = x.head && (x.head.ja || x.head.en) ? x.head : null;
    const title = head ? t('bus.for', { name: nameOf(head, lang) }) : (tag || t('bus.op'));
    const nx = (x.next || []).find((s) => !s.now) || null;
    const next = nx ? t('bus.list.next', { name: nameOf(nx.name, lang) }) : '';
    const time = clockFor(x.reportAt, lang);
    const state = x.stale ? t('bus.stale', { n: Math.max(0, Math.round((now - x.reportAt) / 60000)), time }) : t('bus.live', { time });
    const dist = Number.isFinite(x.d) ? distText(x.d, lang) : '';
    const label = [tag, title, next, state, dist].filter(Boolean).join(', ');
    return `<button type="button" class="row tkb-row" data-bus="${esc(x.id)}" style="--rc:${esc(r ? r.color : '#6B6B70')}" aria-label="${esc(label)}">`
      + `<span class="tkb-tag sm" aria-hidden="true"><b${NON_ASCII.test(tag) ? ' lang="ja"' : ''}>${esc(tag || '·')}</b></span>`
      + `<span class="rt"><b>${esc(title)}</b><span>${esc([next, state].filter(Boolean).join(' · '))}</span></span>`
      + `${dist ? `<span class="rr"><small>${esc(dist)}</small></span>` : ''}</button>`;
  }).join('');
}

/** The sheet's styles (injected once by index.js): the page's tokens, colour only on data (the route), round chips. */
export const BUS_CSS = `
.tkb{padding:2px 0 8px;color:var(--text,#171717)}
.tkb .ph{margin:2px 0 10px}
.tkb-tag{flex:none;min-width:52px;height:32px;padding:0 10px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;background:#fff;box-shadow:inset 0 0 0 2.5px var(--rc,#6B6B70);font:700 15px/1 var(--font);color:var(--text,#171717);white-space:nowrap}
.tkb-live{display:flex;align-items:center;gap:8px;margin:0 0 12px;font:600 14px/18px var(--font);color:var(--text,#171717)}
.tkb-live.stale{color:var(--text2,#6B6B70);font-weight:500}
.tkb-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--income,#1E9E4A)}
.tkb-live.stale .tkb-dot{background:var(--text3,#8A8996)}
.tkb .sech{margin:4px 0 6px}
.tkb-stops{list-style:none;margin:0;padding:0}
.tkb-stops li{position:relative;display:flex;align-items:center;gap:12px;min-height:44px;padding:4px 0}
.tkb-stops li i{flex:none;position:relative;z-index:1;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 2.5px var(--rc,#6B6B70);margin-left:6px}
.tkb-stops li:not(.end)::before{content:"";position:absolute;left:10px;top:50%;height:100%;width:4px;background:var(--rc,#6B6B70)}
.tkb-stops li.now i{background:var(--rc,#6B6B70)}
.tkb-stops li span{min-width:0;flex:1;display:flex;flex-direction:column}
.tkb-stops li b{font:600 15px/20px var(--font)}
.tkb-stops li small{font:400 13px/17px var(--font);color:var(--text2,#6B6B70)}
.tkb-stops li em{font:600 13px/17px var(--font);font-style:normal;color:var(--text2,#6B6B70);flex:none}
.tkb-more{margin:2px 0 10px 30px;font:400 13px/17px var(--font);color:var(--text2,#6B6B70)}
.tkb-note{margin:10px 0 6px;font:400 13px/18px var(--font);color:var(--text2,#6B6B70)}
.tkb-credit{margin:6px 0 0;font:400 13px/18px var(--font);color:var(--text3,#8A8996)}
.tkb-tag.sm{min-width:44px;height:28px;padding:0 8px;border-radius:14px;font-size:13px;box-shadow:inset 0 0 0 2.2px var(--rc,#6B6B70)}
.tkb-row .rt > span{white-space:normal}
`;
