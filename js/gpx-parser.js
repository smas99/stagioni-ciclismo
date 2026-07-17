/**
 * gpx-parser.js
 * Parsing di file GPX (attività ciclistiche), calcolo statistiche
 * (distanza, dislivello, tempo in movimento, durata totale) e rilevamento
 * dei comuni della provincia di Cuneo attraversati, in base alla vicinanza
 * del tracciato ai pallini della mappa (raggio di 800 m).
 */

const GpxParser = (() => {

  const EARTH_R = 6371000; // metri
  // Se la velocità istantanea tra due punti scende sotto questa soglia (m/s)
  // il tratto NON viene conteggiato nel "tempo in movimento" (soste, semafori...)
  const STOP_SPEED_THRESHOLD = 0.6; // m/s (~2.2 km/h)

  // Parametri del filtro dislivello: una finestra di media mobile più corta
  // e una soglia di rumore più bassa "seguono" meglio i saliscendi reali,
  // a scapito di lasciar passare un po' più di rumore GPS. Aumenta questi
  // valori se nei tuoi GPX il dislivello risulta sovrastimato (rumore),
  // diminuiscili se invece ti sembra ancora sottostimato.
  const ELEVATION_SMOOTHING_WINDOW = 3; // punti (era 5)
  const ELEVATION_NOISE_THRESHOLD_M = 0.2; // metri tra punti smussati consecutivi (era 0.5)

  function toRad(d) { return d * Math.PI / 180; }

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(a));
  }

  /**
   * Media mobile su un array di numeri (riduce il rumore GPS dell'altimetria).
   */
  function movingAverage(arr, window) {
    const half = Math.floor(window / 2);
    return arr.map((_, i) => {
      const start = Math.max(0, i - half);
      const end = Math.min(arr.length, i + half + 1);
      const slice = arr.slice(start, end);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  }

  /**
   * Calcola il dislivello positivo totale (metri) a partire dalle quote
   * dei punti traccia. Applica una media mobile per ridurre il rumore
   * dell'altimetro GPS e ignora micro-variazioni tra punti consecutivi
   * sotto ELEVATION_NOISE_THRESHOLD_M, per evitare di sommare rumore come
   * dislivello reale. Ritorna null se il GPX non contiene dati di altitudine.
   */
  function computeElevationGain(points) {
    const elevations = points.map(p => p.ele);
    if (elevations.some(e => e === null || e === undefined || !Number.isFinite(e))) {
      return null;
    }
    const smoothed = movingAverage(elevations, ELEVATION_SMOOTHING_WINDOW);
    let gain = 0;
    for (let i = 1; i < smoothed.length; i++) {
      const diff = smoothed[i] - smoothed[i - 1];
      if (diff > ELEVATION_NOISE_THRESHOLD_M) gain += diff;
    }
    return Math.round(gain);
  }

  function formatHMS(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  /**
   * Estrae i punti traccia (lat, lon, ele, time) da un testo GPX.
   */
  function extractTrackPoints(gpxText) {
    const xml = new DOMParser().parseFromString(gpxText, 'application/xml');
    const parserError = xml.querySelector('parsererror');
    if (parserError) {
      throw new Error('Il file non è un GPX valido (errore di parsing XML).');
    }

    const trkpts = Array.from(xml.getElementsByTagName('trkpt'));
    let points = trkpts;

    // fallback su rtept se non ci sono trkpt
    if (points.length === 0) {
      points = Array.from(xml.getElementsByTagName('rtept'));
    }

    if (points.length === 0) {
      throw new Error('Nessun punto traccia trovato nel file GPX.');
    }

    return points.map((pt) => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      const eleEl = pt.getElementsByTagName('ele')[0];
      const timeEl = pt.getElementsByTagName('time')[0];
      return {
        lat, lon,
        ele: eleEl ? parseFloat(eleEl.textContent) : null,
        time: timeEl ? new Date(timeEl.textContent) : null
      };
    }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }

  /**
   * Calcola distanza totale, tempo in movimento e durata totale.
   */
  function computeStats(points) {
    let distanceM = 0;
    let movingSeconds = 0;
    const hasTime = points.every(p => p.time instanceof Date && !isNaN(p.time));

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const d = haversine(a.lat, a.lon, b.lat, b.lon);
      distanceM += d;

      if (hasTime) {
        const dt = (b.time - a.time) / 1000; // secondi
        if (dt > 0) {
          const speed = d / dt;
          if (speed >= STOP_SPEED_THRESHOLD) {
            movingSeconds += dt;
          }
        }
      }
    }

    let totalSeconds = 0;
    let startTime = null, endTime = null;
    if (hasTime) {
      startTime = points[0].time;
      endTime = points[points.length - 1].time;
      totalSeconds = (endTime - startTime) / 1000;
    }

    return {
      distanceKm: distanceM / 1000,
      movingSeconds: hasTime ? movingSeconds : null,
      totalSeconds: hasTime ? totalSeconds : null,
      startTime, endTime,
      hasTime
    };
  }

  // Raggio entro il quale un comune viene considerato "attraversato" dal
  // tracciato, misurato dal punto del marker sulla mappa (non dal confine
  // amministrativo). Se l'utente ha corretto manualmente la posizione di
  // un comune sulla mappa, viene usata quella posizione corretta.
  const MARKER_PROXIMITY_M = 800;

  /**
   * Costruisce, una volta per analisi, l'elenco {name, lat, lon} di tutti i
   * comuni usando la posizione corretta manualmente se presente in
   * `overrides` (dal foglio "Posizioni"), altrimenti quella di default.
   */
  function buildComuniPoints(overrides) {
    return CUNEO_COMUNI_GEOJSON.features.map(f => {
      const name = f.properties.name;
      const ov = overrides && overrides[name];
      return {
        name,
        lat: ov ? ov.lat : f.properties.lat,
        lon: ov ? ov.lon : f.properties.lon
      };
    });
  }

  /**
   * Comune il cui punto sulla mappa è più vicino a (lat, lon).
   */
  function nearestComune(lat, lon, comuniPoints) {
    let best = null, bestDist = Infinity;
    for (const c of comuniPoints) {
      const d = haversine(lat, lon, c.lat, c.lon);
      if (d < bestDist) { bestDist = d; best = c.name; }
    }
    return { name: best, distance: bestDist };
  }

  /**
   * Tutti i comuni il cui punto sulla mappa dista da (lat, lon) meno di
   * `radiusM` metri, ordinati dal più vicino.
   */
  function comuniWithinRadius(lat, lon, comuniPoints, radiusM) {
    const found = [];
    for (const c of comuniPoints) {
      const d = haversine(lat, lon, c.lat, c.lon);
      if (d <= radiusM) found.push({ name: c.name, distance: d });
    }
    found.sort((a, b) => a.distance - b.distance);
    return found.map(f => f.name);
  }

  /**
   * Scorre il tracciato e determina l'insieme (in ordine di prima comparsa)
   * dei comuni della provincia di Cuneo attraversati: un comune è
   * considerato attraversato se il tracciato passa entro `radiusM` metri
   * dal suo punto sulla mappa. Per performance, campiona un punto ogni
   * `sampleEveryM` metri circa.
   */
  function detectComuniAttraversati(points, comuniPoints, sampleEveryM = 150, radiusM = MARKER_PROXIMITY_M) {
    const ordered = [];
    const seen = new Set();
    let lastSampleDist = -Infinity;
    let cumDist = 0;

    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        cumDist += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
      }
      if (cumDist - lastSampleDist < sampleEveryM && i !== 0 && i !== points.length - 1) {
        continue;
      }
      lastSampleDist = cumDist;

      const names = comuniWithinRadius(points[i].lat, points[i].lon, comuniPoints, radiusM);
      names.forEach(name => {
        if (!seen.has(name)) {
          seen.add(name);
          ordered.push(name);
        }
      });
    }
    return ordered;
  }

  function findComuneName(lat, lon, comuniPoints) {
    return nearestComune(lat, lon, comuniPoints).name || '';
  }

  /**
   * Funzione principale: analizza un testo GPX e ritorna tutti i dati
   * pronti per pre-compilare il form attività.
   * @param gpxText  contenuto testuale del file GPX
   * @param overrides  { nomeComune: {lat, lon}, ... } correzioni manuali
   *        delle posizioni dei comuni (dal foglio "Posizioni"), opzionale
   */
  function parseGpx(gpxText, overrides = {}) {
    const points = extractTrackPoints(gpxText);
    const stats = computeStats(points);
    const comuniPoints = buildComuniPoints(overrides);
    const comuni = detectComuniAttraversati(points, comuniPoints);
    const elevationGainM = computeElevationGain(points);

    const first = points[0];
    const last = points[points.length - 1];

    const partenza = findComuneName(first.lat, first.lon, comuniPoints) || 'Partenza sconosciuta';
    const arrivo = findComuneName(last.lat, last.lon, comuniPoints) || 'Arrivo sconosciuto';

    let data = '';
    let momento = 'mattino';
    if (stats.hasTime && stats.startTime) {
      const d = stats.startTime;
      data = d.toISOString().slice(0, 10);
      const h = d.getHours();
      if (h >= 5 && h < 12) momento = 'mattino';
      else if (h >= 12 && h < 18) momento = 'pomeriggio';
      else if (h >= 18 && h < 22) momento = 'sera';
      else momento = 'notte';
    } else {
      data = new Date().toISOString().slice(0, 10);
    }

    return {
      points,
      pointCount: points.length,
      distanceKm: Math.round(stats.distanceKm * 100) / 100,
      dislivelloM: elevationGainM,
      movingTimeFormatted: stats.hasTime ? formatHMS(stats.movingSeconds) : '',
      totalTimeFormatted: stats.hasTime ? formatHMS(stats.totalSeconds) : '',
      hasTime: stats.hasTime,
      data,
      momento,
      partenza,
      arrivo,
      comuni
    };
  }

  /**
   * Decodifica una "encoded polyline" (formato usato da Google Maps e da
   * Strava per `map.summary_polyline`) in un array di punti {lat, lon}.
   * Non contiene quote né timestamp: utile solo per il rilevamento comuni.
   */
  function decodePolyline(encoded, precision = 5) {
    if (!encoded) return [];
    const factor = Math.pow(10, precision);
    let index = 0, lat = 0, lon = 0;
    const points = [];

    while (index < encoded.length) {
      let result = 1, shift = 0, b;
      do {
        b = encoded.charCodeAt(index++) - 63 - 1;
        result += b << shift;
        shift += 5;
      } while (b >= 0x1f);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);

      result = 1; shift = 0;
      do {
        b = encoded.charCodeAt(index++) - 63 - 1;
        result += b << shift;
        shift += 5;
      } while (b >= 0x1f);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);

      points.push({ lat: lat / factor, lon: lon / factor });
    }
    return points;
  }

  return {
    parseGpx, haversine, formatHMS,
    buildComuniPoints, nearestComune, comuniWithinRadius, detectComuniAttraversati,
    decodePolyline,
    MARKER_PROXIMITY_M
  };
})();
