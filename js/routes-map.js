/**
 * routes-map.js
 * Seconda mappa Leaflet, indipendente da map.js, che disegna i percorsi
 * (polyline) delle attività importate da Strava. Non gestisce i pallini
 * dei comuni: quella resta la responsabilità di CnMap (map.js).
 *
 * I dati arrivano già filtrati per anno da app.js (vedi applyRoutesToMap):
 * questo modulo si limita a decodificare a.polyline (encoded polyline di
 * Strava, stesso formato usato da GpxParser.decodePolyline) e a disegnarla.
 */
const CnRoutesMap = (() => {
  const ROUTE_COLOR = '#4C7A4F';
  const ROUTE_COLOR_HOVER = '#C2542E';

  let map = null;
  let routesLayer = null;

  function init(containerId) {
    map = L.map(containerId, { scrollWheelZoom: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const boundaries = L.geoJSON(CUNEO_COMUNI_GEOJSON, {
      style: { color: '#1F3D2B', weight: 1, opacity: 0.2, fillOpacity: 0 }
    }).addTo(map);

    map.fitBounds(boundaries.getBounds(), { padding: [10, 10] });

    routesLayer = L.layerGroup().addTo(map);

    return map;
  }

  function routeLabel(a) {
    const parts = [a.data || '', a.km ? `${a.km} km` : ''].filter(Boolean);
    return parts.join(' · ') || 'Attività';
  }

  /**
   * Ridisegna tutti i percorsi a partire da un array di attività (già
   * filtrate per anno dal chiamante). Ignora silenziosamente le attività
   * senza campo `polyline` (es. inserite a mano, o Strava non ancora
   * sincronizzato/backfillato).
   *
   * @returns {number} quante attività avevano un percorso disegnabile
   */
  function setRoutes(activities) {
    if (!map || !routesLayer) return 0;
    routesLayer.clearLayers();

    const allLatLngs = [];
    let drawn = 0;

    activities.forEach(a => {
      if (!a.polyline) return;
      const points = GpxParser.decodePolyline(a.polyline);
      if (points.length < 2) return;

      const latlngs = points.map(p => [p.lat, p.lon]);
      const line = L.polyline(latlngs, {
        color: ROUTE_COLOR,
        weight: 3,
        opacity: 0.6
      });

      line.bindTooltip(routeLabel(a), { sticky: true });
      line.on('mouseover', () => line.setStyle({ color: ROUTE_COLOR_HOVER, weight: 4, opacity: 0.9 }));
      line.on('mouseout', () => line.setStyle({ color: ROUTE_COLOR, weight: 3, opacity: 0.6 }));

      line.addTo(routesLayer);
      allLatLngs.push(...latlngs);
      drawn++;
    });

    if (allLatLngs.length) {
      map.fitBounds(allLatLngs, { padding: [20, 20] });
    }

    return drawn;
  }

  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  return { init, setRoutes, invalidateSize };
})();
