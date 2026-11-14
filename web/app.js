import { prepare, busesAt, activeServices, jakartaClock } from './sim.js';

const $ = id => document.getElementById(id);
const fail = msg => { $('status').textContent = ''; $('err').textContent = msg; };

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',   // basemap gratis tanpa kunci, sama seperti referensi tokyo-rail-twin
  center: [106.8229, -6.2003], zoom: 11,
  attributionControl: { customAttribution: 'Jadwal: GTFS PT Transportasi Jakarta' },
});
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

try {
  const res = await fetch('data/jakarta.json');
  if (!res.ok) throw new Error(`data/jakarta.json: HTTP ${res.status}. Jalankan "bun run data" dulu.`);
  const pack = await res.json();
  const trips = prepare(pack);
  if (!map.loaded()) await map.once('load');

  map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: trips.map(t => ({
    type: 'Feature', properties: { color: pack.routes[t.r].color },
    geometry: { type: 'LineString', coordinates: Array.from({ length: t.shape.xy.length / 2 }, (_, i) => [t.shape.xy[2 * i], t.shape.xy[2 * i + 1]]) },
  })) } });
  map.addLayer({ id: 'routes', type: 'line', source: 'routes',
    paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.35 } });

  map.addSource('buses', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'buses', type: 'circle', source: 'buses', paint: {
    'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 6] } });

  const tick = () => {
    const { sec, day, yesterday } = jakartaClock(Date.now());
    const buses = busesAt(trips, sec, activeServices(pack.calendar, day), activeServices(pack.calendar, yesterday));
    map.getSource('buses').setData({ type: 'FeatureCollection', features: buses.map(b => {
      const r = pack.routes[b.trip.r];
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
        properties: { color: r.color, short: r.short, long: r.long, head: b.trip.head } };
    }) });
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0'), mm = String(Math.floor(sec / 60) % 60).padStart(2, '0');
    $('status').textContent = `${buses.length.toLocaleString('id-ID')} bus · ${hh}.${mm} WIB`;
  };
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 1000);

  map.on('click', 'buses', e => {
    const p = e.features[0].properties;
    const el = document.createElement('div');                 // textContent, bukan HTML: nama rute berasal dari data luar
    el.append(Object.assign(document.createElement('strong'), { textContent: `Rute ${p.short}` }),
      document.createElement('br'), p.long, document.createElement('br'), `Menuju ${p.head}`);
    new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
  });
  map.on('mouseenter', 'buses', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'buses', () => { map.getCanvas().style.cursor = ''; });
} catch (e) {
  fail(e.message || String(e));
}
