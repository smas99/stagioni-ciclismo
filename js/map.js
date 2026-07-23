/**
 * map.js
 * Mappa Leaflet della provincia di Cuneo con i 247 comuni come pallini:
 * rosso = non ancora visitato, verde = registrato in almeno un'attività.
 *
 * Le coordinate calcolate automaticamente (js/comuni-data.js) sono un punto
 * geometricamente valido dentro al confine del comune, ma non sempre
 * coincidono col centro abitato reale. È possibile correggerle a mano in
 * "modalità modifica": si trascina il pallino nella posizione corretta e la
 * correzione viene salvata sul foglio Google Sheets "Posizioni" (tramite
 * SheetsApi), così resta valida su qualsiasi dispositivo/browser.
 */

const CnMap = (() => {
  const COLOR_UNVISITED = '#C2542E';
  const COLOR_VISITED = '#4C7A4F';

  let map = null;
  let markersByName = {};
  let baseCoordsByName = {}; // posizione "di fabbrica" (dal GeoJSON), per il reset
  let visitedSet = new Set();
  let overrides = {};
  let editMode = false;
  let onSelectCallback = null;
  let onOverrideChangeCallback = null;
  let onSaveErrorCallback = null;

  function notifyOverrideChange(status) {
    if (onOverrideChangeCallback) onOverrideChangeCallback(Object.keys(overrides).length, status);
  }
  function notifySaveError(err, name) {
    if (onSaveErrorCallback) onSaveErrorCallback(err, name);
  }

  function dotIcon(color, draggable) {
    return L.divIcon({
      className: 'comune-dot-marker' + (draggable ? ' draggable' : ''),
      html: `<span style="background:${color}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  function colorFor(name) {
    return visitedSet.has(name) ? COLOR_VISITED : COLOR_UNVISITED;
  }

  function popupHtml(name) {
    const hasOverride = !!overrides[name];
    let html = `<b>${name}</b>${visitedSet.has(name) ? ' ✅' : ''}`;
    if (editMode) {
      html += `<br><small>Trascina il pallino per correggere la posizione.</small>`;
      if (hasOverride) {
        html += `<br><button type="button" class="popup-reset-btn" data-name="${name}">Ripristina posizione originale</button>`;
      }
    }
    return html;
  }

  /**
   * @param containerId  id del div della mappa
   * @param initialOverrides  { nomeComune: {lat, lon}, ... } già caricato
   *        dal foglio "Posizioni" (fetch fatto dal chiamante, vedi app.js)
   */
  function init(containerId, initialOverrides) {
    overrides = initialOverrides ? { ...initialOverrides } : {};

    map = L.map(containerId, { scrollWheelZoom: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const boundaries = L.geoJSON(CUNEO_COMUNI_GEOJSON, {
      style: { color: '#1F3D2B', weight: 1, opacity: 0.25, fillOpacity: 0.02 }
    }).addTo(map);

    map.fitBounds(boundaries.getBounds(), { padding: [10, 10] });

    CUNEO_COMUNI_GEOJSON.features.forEach(f => {
      const { name, lat, lon } = f.properties;
      baseCoordsByName[name] = { lat, lon };

      const pos = overrides[name] || { lat, lon };
      const marker = L.marker([pos.lat, pos.lon], {
        icon: dotIcon(colorFor(name), false),
        draggable: false
      }).addTo(map);

      marker.bindPopup(popupHtml(name));
      marker.on('click', () => { if (onSelectCallback) onSelectCallback(name); });
      marker.on('dragend', () => onMarkerDragEnd(name, marker));

      markersByName[name] = marker;
    });

    map.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const btn = el ? el.querySelector('.popup-reset-btn') : null;
      if (btn) {
        btn.addEventListener('click', () => resetComune(btn.dataset.name));
      }
    });

    return map;
  }

  async function onMarkerDragEnd(name, marker) {
    const ll = marker.getLatLng();
    overrides[name] = { lat: ll.lat, lon: ll.lng };
    marker.setPopupContent(popupHtml(name));
    notifyOverrideChange('saving');
    try {
      await SheetsApi.setPosition(name, ll.lat, ll.lng);
      notifyOverrideChange('saved');
    } catch (err) {
      notifySaveError(err, name);
      notifyOverrideChange('error');
    }
  }

  function setVisited(namesArray) {
    visitedSet = new Set(namesArray);
    Object.entries(markersByName).forEach(([name, marker]) => {
      marker.setIcon(dotIcon(colorFor(name), editMode));
    });
  }

  function isVisited(name) {
    return visitedSet.has(name);
  }

  function focusComune(name) {
    const marker = markersByName[name];
    if (marker && map) {
      map.setView(marker.getLatLng(), 12, { animate: true });
      marker.openPopup();
    }
  }

  function setEditMode(on) {
    editMode = on;
    Object.entries(markersByName).forEach(([name, marker]) => {
      marker.dragging[on ? 'enable' : 'disable']();
      marker.setIcon(dotIcon(colorFor(name), on));
      if (marker.isPopupOpen()) marker.setPopupContent(popupHtml(name));
    });
  }

  async function resetComune(name) {
    const marker = markersByName[name];
    const base = baseCoordsByName[name];
    if (!marker || !base) return;
    notifyOverrideChange('saving');
    try {
      await SheetsApi.resetPosition(name);
      delete overrides[name];
      marker.setLatLng([base.lat, base.lon]);
      marker.setPopupContent(popupHtml(name));
      notifyOverrideChange('saved');
    } catch (err) {
      notifySaveError(err, name);
      notifyOverrideChange('error');
    }
  }

  function hasOverride(name) { return !!overrides[name]; }
  function overrideCount() { return Object.keys(overrides).length; }

  function onSelect(cb) { onSelectCallback = cb; }
  function onOverrideChange(cb) { onOverrideChangeCallback = cb; }
  function onSaveError(cb) { onSaveErrorCallback = cb; }

  function getAllNames() {
    return CUNEO_COMUNI_GEOJSON.features
      .map(f => f.properties.name)
      .sort((a, b) => a.localeCompare(b, 'it'));
  }

  return {
    init, setVisited, isVisited, focusComune, onSelect, onOverrideChange, onSaveError,
    getAllNames, setEditMode, resetComune, hasOverride, overrideCount
  };
})();
