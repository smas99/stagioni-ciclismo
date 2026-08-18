/**
 * Code.gs
 * Backend per il sito "Granfondo Personale" — provincia di Cuneo.
 *
 * Gestisce tre fogli nello stesso Google Sheet:
 *  - "Attivita"  : le uscite in bici (import GPX + manuali + Strava)
 *  - "Bici"      : l'elenco delle tue bici
 *  - "Posizioni" : le correzioni manuali di posizione dei pallini comuni
 *
 * Più il collegamento OAuth con Strava (token salvati nelle "Proprietà
 * dello script", non in un foglio, per tenerli fuori dalla vista normale).
 *
 * COME INSTALLARLO (vedi anche README.md):
 * 1. Crea un nuovo Google Sheet (foglio Google) vuoto.
 * 2. Menu Estensioni > Apps Script.
 * 3. Cancella il contenuto di default e incolla questo intero file.
 * 4. Salva (icona dischetto), dai un nome al progetto (es. "GranfondoBackend").
 * 5. In alto a destra: Esegui > funzione "setup" (autorizza i permessi richiesti).
 *    Questo crea automaticamente i tre fogli con le intestazioni corrette.
 * 6. Menu Esegui la distribuzione > Nuova distribuzione.
 *    - Tipo: "App web"
 *    - Esegui come: "Me"
 *    - Chi ha accesso: "Chiunque" (necessario perché il sito è statico e
 *      chiama l'URL senza login Google)
 * 7. Copia l'URL "app web" generato (finisce con /exec) e incollalo nella
 *    pagina "Impostazioni" del sito.
 *
 * Per collegare Strava, vedi la sezione dedicata in README.md (richiede di
 * impostare STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET nelle Proprietà dello
 * script: icona ingranaggio "Impostazioni progetto" nell'editor Apps Script).
 *
 * Se avevi già distribuito una versione precedente di questo script, dopo
 * aver incollato la nuova versione ricordati di:
 *  Gestisci distribuzioni → matita (modifica) → Nuova versione → Esegui la
 *  distribuzione. E rilancia una volta la funzione "setup" per creare i
 *  fogli nuovi su un foglio già esistente.
 *
 * NB: i tuoi dati restano comunque solo nel TUO Google Sheet personale;
 * l'URL della web app è noto solo a te finché non lo condividi.
 */

const SHEET_ATTIVITA = 'Attivita';
const HEADERS_ATTIVITA = [
  'id', 'data', 'momento', 'tipo', 'partenza', 'arrivo',
  'km', 'dislivello', 'tempoMovimento', 'durataTotale', 'bici', 'comuni', 'note', 'inserito',
  'stravaId' // aggiunto in coda: non tocca l'ordine delle colonne già in uso
];

const SHEET_BICI = 'Bici';
const HEADERS_BICI = ['nome'];

const SHEET_POSIZIONI = 'Posizioni';
const HEADERS_POSIZIONI = ['comune', 'lat', 'lon'];

const SHEET_TRACCE = 'Tracce';
const HEADERS_TRACCE = ['stravaId', 'polyline'];

// ---------------- STRAVA: costanti ----------------
const STRAVA_OAUTH_AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const STRAVA_OAUTH_TOKEN = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const MAX_STRAVA_SYNC_PAGES = 20; // sicurezza: fino a ~600 attività per sincronizzazione

function setup() {
  ensureSheet_(SHEET_ATTIVITA, HEADERS_ATTIVITA);
  ensureSheet_(SHEET_BICI, HEADERS_BICI);
  ensureSheet_(SHEET_POSIZIONI, HEADERS_POSIZIONI);
  ensureSheet_(SHEET_TRACCE, HEADERS_TRACCE);
}

/**
 * Esegui questa funzione UNA VOLTA SOLA dall'editor Apps Script (menu a
 * tendina delle funzioni in alto → seleziona "authorizeExternalRequests" →
 * ▶ Esegui) prima di collegare Strava per la prima volta. Serve a farti
 * comparire la richiesta di consenso per il permesso "effettuare richieste
 * esterne" (necessario per parlare con l'API di Strava), che la web app da
 * sola non può richiederti mentre è in uso dal sito. Una volta autorizzato
 * qui, resta valido anche per tutte le chiamate che arrivano dal sito.
 */
function authorizeExternalRequests() {
  const res = UrlFetchApp.fetch('https://www.strava.com/api/v3/athlete', { muteHttpExceptions: true });
  Logger.log('Test richiesta esterna riuscito, codice risposta: ' + res.getResponseCode());
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Il foglio esiste già: se questa versione di Code.gs prevede più colonne
  // di quelle già presenti (es. dopo un aggiornamento che aggiunge un
  // campo), estende automaticamente la riga di intestazione con quelle
  // mancanti, senza toccare i dati già scritti.
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.length > currentHeaders.length) {
    const missing = headers.slice(currentHeaders.length);
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        obj[h] = val;
      });
      return obj;
    });
}

// ---------------- GET ----------------

function doGet(e) {
  // Callback OAuth di Strava: Strava reindirizza qui con ?code=...&state=...
  // (nessun parametro "action" in questo caso).
  if (e.parameter.code) {
    return handleStravaCallback_(e.parameter.code);
  }

  const action = (e.parameter.action || 'list');
  try {
    if (action === 'ping') {
      return jsonResponse_({ ok: true, sheets: [SHEET_ATTIVITA, SHEET_BICI, SHEET_POSIZIONI] });
    }

    if (action === 'list') {
      const activities = sheetToObjects_(ensureSheet_(SHEET_ATTIVITA, HEADERS_ATTIVITA));
      return jsonResponse_({ activities });
    }

    if (action === 'bikes') {
      const rows = sheetToObjects_(ensureSheet_(SHEET_BICI, HEADERS_BICI));
      const bikes = rows.map(r => r.nome).filter(Boolean);
      return jsonResponse_({ bikes });
    }

    if (action === 'positions') {
      const rows = sheetToObjects_(ensureSheet_(SHEET_POSIZIONI, HEADERS_POSIZIONI));
      const positions = {};
      rows.forEach(r => {
        if (r.comune) {
          positions[r.comune] = { lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
        }
      });
      return jsonResponse_({ positions });
    }

    if (action === 'tracce') {
      const rows = sheetToObjects_(ensureSheet_(SHEET_TRACCE, HEADERS_TRACCE));
      const zone = privacyZone_();
      const tracce = rows
        .filter(r => r.stravaId && r.polyline)
        .map(r => ({
          stravaId: r.stravaId,
          // Se è configurata una zona privacy (Proprietà dello script), il
          // tratto vicino a quel punto viene tagliato QUI, lato server:
          // chi chiama questa azione da qualsiasi browser/dispositivo non
          // riceve mai le coordinate originali di quel tratto.
          polyline: zone ? clipPolylineToZone_(r.polyline, zone) : r.polyline
        }))
        .filter(t => t.polyline); // scarta i percorsi interamente dentro la zona privacy
      return jsonResponse_({ tracce });
    }

    if (action === 'privacyZoneStatus') {
      // Conferma solo SE è attiva e il raggio: mai le coordinate esatte,
      // così anche questa azione (pubblica, chiamabile da chiunque abbia
      // il link) non rivela mai dove si trova il punto.
      const zone = privacyZone_();
      return jsonResponse_({ active: !!zone, radiusM: zone ? zone.radiusM : null });
    }

    if (action === 'stravaAuthUrl') {
      if (!stravaClientId_()) {
        return jsonResponse_({ error: 'Configura prima STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET nelle Proprietà dello script (vedi README).' });
      }
      return jsonResponse_({ url: stravaAuthUrl_() });
    }

    if (action === 'stravaStatus') {
      return jsonResponse_({ connected: stravaIsConnected_() });
    }

    if (action === 'stravaSync') {
      return handleStravaSync_();
    }

    return jsonResponse_({ error: 'Azione GET non riconosciuta.' });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

// ---------------- POST ----------------

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'addActivity') return handleAddActivity_(body.data || {});
    if (action === 'addBike') return handleAddBike_(body.name || '');
    if (action === 'removeBike') return handleRemoveBike_(body.name || '');
    if (action === 'setPosition') return handleSetPosition_(body.name || '', body.lat, body.lon);
    if (action === 'resetPosition') return handleResetPosition_(body.name || '');

    return jsonResponse_({ error: 'Azione POST non riconosciuta.' });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

function handleAddActivity_(d) {
  const sheet = ensureSheet_(SHEET_ATTIVITA, HEADERS_ATTIVITA);
  const id = Utilities.getUuid();
  const insertedAt = new Date().toISOString();

  sheet.appendRow([
    id,
    d.data || '',
    d.momento || '',
    d.tipo || '',
    d.partenza || '',
    d.arrivo || '',
    (typeof d.km === 'number') ? d.km : parseFloat(d.km) || 0,
    (typeof d.dislivello === 'number') ? d.dislivello : parseFloat(d.dislivello) || 0,
    d.tempoMovimento || '',
    d.durataTotale || '',
    d.bici || '',
    d.comuni || '',
    d.note || '',
    insertedAt,
    d.stravaId || ''
  ]);

  if (d.polyline && d.stravaId) {
    upsertTraccia_(d.stravaId, d.polyline);
  }

  return jsonResponse_({ ok: true, id: id });
}

function upsertTraccia_(stravaId, polyline) {
  stravaId = String(stravaId);
  const sheet = ensureSheet_(SHEET_TRACCE, HEADERS_TRACCE);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === stravaId) {
      sheet.getRange(i + 1, 1, 1, 2).setValues([[stravaId, polyline]]);
      return;
    }
  }
  sheet.appendRow([stravaId, polyline]);
}

function handleAddBike_(name) {
  name = String(name).trim();
  if (!name) return jsonResponse_({ error: 'Nome bici mancante.' });

  const sheet = ensureSheet_(SHEET_BICI, HEADERS_BICI);
  const existing = sheetToObjects_(sheet).map(r => String(r.nome).toLowerCase());
  if (!existing.includes(name.toLowerCase())) {
    sheet.appendRow([name]);
  }
  return jsonResponse_({ ok: true });
}

function handleRemoveBike_(name) {
  name = String(name).trim();
  const sheet = ensureSheet_(SHEET_BICI, HEADERS_BICI);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]).toLowerCase() === name.toLowerCase()) {
      sheet.deleteRow(i + 1);
    }
  }
  return jsonResponse_({ ok: true });
}

function handleSetPosition_(name, lat, lon) {
  name = String(name).trim();
  lat = parseFloat(lat);
  lon = parseFloat(lon);
  if (!name || isNaN(lat) || isNaN(lon)) {
    return jsonResponse_({ error: 'Dati posizione non validi.' });
  }

  const sheet = ensureSheet_(SHEET_POSIZIONI, HEADERS_POSIZIONI);
  const values = sheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === name) {
      sheet.getRange(i + 1, 1, 1, 3).setValues([[name, lat, lon]]);
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([name, lat, lon]);
  }
  return jsonResponse_({ ok: true });
}

function handleResetPosition_(name) {
  name = String(name).trim();
  const sheet = ensureSheet_(SHEET_POSIZIONI, HEADERS_POSIZIONI);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === name) {
      sheet.deleteRow(i + 1);
    }
  }
  return jsonResponse_({ ok: true });
}

// ---------------- STRAVA ----------------

function getScriptProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
function setScriptProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function stravaClientId_() { return getScriptProp_('STRAVA_CLIENT_ID'); }
function stravaClientSecret_() { return getScriptProp_('STRAVA_CLIENT_SECRET'); }

function stravaAuthUrl_() {
  const redirectUri = ScriptApp.getService().getUrl();
  const params = {
    client_id: stravaClientId_(),
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read_all',
    state: 'ciclocuneo'
  };
  const qs = Object.keys(params)
    .map(k => k + '=' + encodeURIComponent(params[k]))
    .join('&');
  return STRAVA_OAUTH_AUTHORIZE + '?' + qs;
}

function stravaIsConnected_() {
  return !!getScriptProp_('STRAVA_REFRESH_TOKEN');
}

function stravaExchangeCode_(code) {
  const res = UrlFetchApp.fetch(STRAVA_OAUTH_TOKEN, {
    method: 'post',
    payload: {
      client_id: stravaClientId_(),
      client_secret: stravaClientSecret_(),
      code: code,
      grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (json.access_token) {
    setScriptProp_('STRAVA_ACCESS_TOKEN', json.access_token);
    setScriptProp_('STRAVA_REFRESH_TOKEN', json.refresh_token);
    setScriptProp_('STRAVA_EXPIRES_AT', String(json.expires_at));
  }
  return json;
}

function handleStravaCallback_(code) {
  try {
    const result = stravaExchangeCode_(code);
    if (result.access_token) {
      return HtmlService.createHtmlOutput(
        '<html><body style="font-family:sans-serif; padding:40px; text-align:center;">' +
        '<h2>✅ Strava collegato correttamente</h2>' +
        '<p>Puoi chiudere questa scheda e tornare al sito, poi premere "Sincronizza ora".</p>' +
        '</body></html>'
      );
    }
    return HtmlService.createHtmlOutput(
      '<p>Errore nel collegamento a Strava: ' + JSON.stringify(result) + '</p>'
    );
  } catch (err) {
    return HtmlService.createHtmlOutput('<p>Errore: ' + String(err) + '</p>');
  }
}

function stravaValidAccessToken_() {
  const expiresAt = parseInt(getScriptProp_('STRAVA_EXPIRES_AT') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now < expiresAt - 60) {
    return getScriptProp_('STRAVA_ACCESS_TOKEN');
  }
  const refreshToken = getScriptProp_('STRAVA_REFRESH_TOKEN');
  if (!refreshToken) throw new Error('Strava non collegato.');

  const res = UrlFetchApp.fetch(STRAVA_OAUTH_TOKEN, {
    method: 'post',
    payload: {
      client_id: stravaClientId_(),
      client_secret: stravaClientSecret_(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    },
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (!json.access_token) throw new Error('Rinnovo token Strava fallito: ' + res.getContentText());

  setScriptProp_('STRAVA_ACCESS_TOKEN', json.access_token);
  setScriptProp_('STRAVA_REFRESH_TOKEN', json.refresh_token);
  setScriptProp_('STRAVA_EXPIRES_AT', String(json.expires_at));
  return json.access_token;
}

function stravaApiGet_(path, accessToken) {
  const res = UrlFetchApp.fetch(STRAVA_API_BASE + path, {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error('Errore API Strava (' + code + '): ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function isBikeActivity_(a) {
  const t = String(a.sport_type || a.type || '').toLowerCase();
  if (t === 'virtualride') return false; // dal 27/07/2026: le attività virtuali non vengono più importate
  return t.indexOf('ride') !== -1 || t.indexOf('bike') !== -1 || t.indexOf('velomobile') !== -1;
}

function existingStravaIds_() {
  const rows = sheetToObjects_(ensureSheet_(SHEET_ATTIVITA, HEADERS_ATTIVITA));
  const ids = new Set();
  rows.forEach(r => { if (r.stravaId) ids.add(String(r.stravaId)); });
  return ids;
}

function handleStravaSync_() {
  if (!stravaIsConnected_()) {
    return jsonResponse_({ error: 'Strava non collegato. Vai su Impostazioni e collega Strava.' });
  }

  const accessToken = stravaValidAccessToken_();
  const already = existingStravaIds_();
  const lastSync = parseInt(getScriptProp_('STRAVA_LAST_SYNC_EPOCH') || '0', 10);

  let page = 1;
  const perPage = 30;
  const collected = [];
  let newestEpoch = lastSync;
  const gearCache = {};

  while (page <= MAX_STRAVA_SYNC_PAGES) {
    const batch = stravaApiGet_(
      '/athlete/activities?after=' + lastSync + '&page=' + page + '&per_page=' + perPage,
      accessToken
    );
    if (!batch || batch.length === 0) break;

    batch.forEach(a => {
      if (a.start_date) {
        const epoch = Math.floor(new Date(a.start_date).getTime() / 1000);
        if (epoch > newestEpoch) newestEpoch = epoch;
      }
      if (!isBikeActivity_(a)) return;
      if (already.has(String(a.id))) return;

      let gearName = '';
      if (a.gear_id) {
        if (gearCache[a.gear_id] === undefined) {
          try {
            const gear = stravaApiGet_('/gear/' + a.gear_id, accessToken);
            gearCache[a.gear_id] = (gear && gear.name) ? gear.name : '';
          } catch (e) {
            gearCache[a.gear_id] = '';
          }
        }
        gearName = gearCache[a.gear_id];
      }

      collected.push({
        stravaId: String(a.id),
        name: a.name,
        distance: a.distance,
        movingTime: a.moving_time,
        elapsedTime: a.elapsed_time,
        elevationGain: a.total_elevation_gain,
        startDateLocal: a.start_date_local,
        startLatLng: a.start_latlng,
        endLatLng: a.end_latlng,
        polyline: a.map ? a.map.summary_polyline : '',
        workoutType: a.workout_type,
        gearName: gearName
      });
    });

    if (batch.length < perPage) break;
    page++;
  }

  setScriptProp_('STRAVA_LAST_SYNC_EPOCH', String(newestEpoch));
  return jsonResponse_({ activities: collected });
}

// ---------------- ZONA PRIVACY PERCORSI ----------------
// Si configura SOLO qui, nell'editor Apps Script (icona ingranaggio
// "Impostazioni progetto" → "Proprietà dello script" → aggiungi):
//   PRIVACY_ZONE_LAT        es. 44.4056
//   PRIVACY_ZONE_LON        es. 7.5432
//   PRIVACY_ZONE_RADIUS_M   es. 400
// MAI dal sito: così il punto esatto (es. casa) non passa mai per il
// client e non è leggibile da chi apre il link, nemmeno indirettamente.
// Il taglio del tratto vicino a quel punto avviene qui, prima che
// l'azione "tracce" risponda a qualsiasi chiamata. Se non imposti queste
// tre proprietà, la zona è semplicemente disattivata (percorsi interi).

function privacyZone_() {
  const lat = parseFloat(getScriptProp_('PRIVACY_ZONE_LAT'));
  const lon = parseFloat(getScriptProp_('PRIVACY_ZONE_LON'));
  const radiusM = parseFloat(getScriptProp_('PRIVACY_ZONE_RADIUS_M'));
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(radiusM)) return null;
  return { lat: lat, lon: lon, radiusM: radiusM };
}

function haversineM_(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = function (d) { return d * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.pow(Math.sin(dLat / 2), 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.pow(Math.sin(dLon / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Decodifica una encoded polyline (formato Google/Strava) in punti {lat, lon}.
function decodePolyline_(encoded, precision) {
  precision = precision || 5;
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

// Ricodifica punti {lat, lon} in una encoded polyline (stesso formato).
function encodePolyline_(points, precision) {
  precision = precision || 5;
  const factor = Math.pow(10, precision);
  let prevLat = 0, prevLon = 0;
  let out = '';

  function encodeValue(v) {
    v = v < 0 ? ~(v << 1) : (v << 1);
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    s += String.fromCharCode(v + 63);
    return s;
  }

  points.forEach(function (p) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    out += encodeValue(lat - prevLat);
    out += encodeValue(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  });
  return out;
}

// Taglia il tratto iniziale e/o finale di una polyline entro zone.radiusM
// metri da (zone.lat, zone.lon), poi la ricodifica. Ritorna '' se l'intero
// percorso ricade nella zona (in quel caso va scartato del tutto).
function clipPolylineToZone_(encoded, zone) {
  const points = decodePolyline_(encoded);
  if (points.length === 0) return '';

  const inZone = function (p) { return haversineM_(p.lat, p.lon, zone.lat, zone.lon) <= zone.radiusM; };

  let start = 0;
  while (start < points.length && inZone(points[start])) start++;

  let end = points.length - 1;
  while (end >= start && inZone(points[end])) end--;

  if (end < start) return '';
  const clipped = points.slice(start, end + 1);
  if (clipped.length < 2) return '';
  return encodePolyline_(clipped);
}
