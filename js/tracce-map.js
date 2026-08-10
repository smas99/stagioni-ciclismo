/**
 * tracce-map.js
 * Mappa Leaflet a parte con i percorsi (tracciati GPS) delle attività
 * sincronizzate da Strava. Ogni traccia arriva dal foglio "Tracce" come
 * encoded polyline (stesso formato usato da Google Maps e da Strava),
 * collegata alle attività tramite stravaId — nessun dato duplicato nel
 * foglio "Attivita".
 */

const TracceMap = (() => {
  const TRACK_COLOR = '#C2542E';
  const TRACK_COLOR_HOVER = '#9E3F1E';
  const TRACK_COLOR_SELECTED = '#161310';

  let map = null;
  let layerGroup = null;
  let polylinesById = {};
  let selectedId = null;
  let onSelectCallback = null;

  function init(containerId) {
    map = L.map(containerId, { scrollWheelZoom: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // vista iniziale sulla provincia di Cuneo, in attesa dei percorsi
    map.setView([44.4, 7.55], 9);

    layerGroup = L.layerGroup().addTo(map);
    return map;
  }

  function clear() {
    if (layerGroup) layerGroup.clearLayers();
    polylinesById = {};
    selectedId = null;
  }

  function normalStyle() {
    return { color: TRACK_COLOR, weight: 3, opacity: 0.7 };
  }

  /**
   * @param tracce   array di { stravaId, polyline } dal foglio Tracce
   * @param popupFn  funzione(stravaId) => html popup, facoltativa
   */
  function render(tracce, popupFn) {
    if (!map) return;
    clear();

    const allPoints = [];

    tracce.forEach(t => {
      if (!t.polyline) return;
      const decoded = GpxParser.decodePolyline(t.polyline);
      if (decoded.length < 2) return;

      const latlngs = decoded.map(p => [p.lat, p.lon]);
      const poly = L.polyline(latlngs, normalStyle()).addTo(layerGroup);

      poly.on('mouseover', () => {
        if (String(t.stravaId) !== String(selectedId)) {
          poly.setStyle({ color: TRACK_COLOR_HOVER, weight: 5, opacity: 1 });
        }
      });
      poly.on('mouseout', () => {
        if (String(t.stravaId) !== String(selectedId)) {
          poly.setStyle(normalStyle());
        }
      });
      poly.on('click', () => select(t.stravaId));

      if (popupFn) {
        const html = popupFn(t.stravaId);
        if (html) poly.bindPopup(html);
      }

      polylinesById[t.stravaId] = poly;
      latlngs.forEach(ll => allPoints.push(ll));
    });

    if (allPoints.length) {
      map.fitBounds(allPoints, { padding: [24, 24] });
    }
  }

  /**
   * Seleziona un percorso (lo colora di nero e lo tiene così finché non se
   * ne seleziona un altro o non si richiama select(null)). Richiamabile sia
   * da un click sulla mappa sia dalla lista laterale in app.js.
   */
  function select(stravaId) {
    const idStr = (stravaId !== null && stravaId !== undefined) ? String(stravaId) : null;
    const previous = selectedId;
    selectedId = (idStr && polylinesById[idStr]) ? idStr : null;

    if (previous && polylinesById[previous]) {
      polylinesById[previous].setStyle(normalStyle());
    }
    if (selectedId && polylinesById[selectedId]) {
      polylinesById[selectedId].setStyle({ color: TRACK_COLOR_SELECTED, weight: 5, opacity: 1 });
      polylinesById[selectedId].bringToFront();
    }
    if (onSelectCallback) onSelectCallback(selectedId);
  }

  function focus(stravaId) {
    const poly = polylinesById[stravaId];
    if (poly && map) {
      map.fitBounds(poly.getBounds(), { padding: [30, 30] });
      poly.openPopup();
    }
    select(stravaId);
  }

  function onSelect(cb) { onSelectCallback = cb; }

  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  return { init, render, focus, select, onSelect, invalidateSize };
})();
