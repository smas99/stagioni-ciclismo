/**
 * sheets-api.js
 * Comunicazione con la Web App di Google Apps Script collegata al foglio
 * Google Sheets personale. Vedi apps-script/Code.gs e README.md.
 *
 * Tre "risorse" gestite, ognuna su un foglio dedicato:
 *  - Attivita  (le uscite in bici)
 *  - Bici      (elenco bici, usato per l'autocompletamento nei form)
 *  - Posizioni (correzioni manuali dei pallini comuni sulla mappa)
 *
 * Solo l'URL della web app resta salvato in locale (localStorage): serve
 * per sapere QUALE foglio contattare, non contiene dati dell'attività.
 */

const SheetsApi = (() => {

  const STORAGE_KEY_URL = 'ciclocuneo_sheets_url';

  function getUrl() {
    return localStorage.getItem(STORAGE_KEY_URL) || '';
  }

  function setUrl(url) {
    localStorage.setItem(STORAGE_KEY_URL, url.trim());
  }

  async function apiGet(action) {
    const url = getUrl();
    if (!url) throw new Error('Nessun URL Google Sheets configurato (vedi Impostazioni).');
    const res = await fetch(`${url}?action=${encodeURIComponent(action)}`, { method: 'GET' });
    if (!res.ok) throw new Error(`Errore HTTP ${res.status}.`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }

  async function apiPost(payload) {
    const url = getUrl();
    if (!url) throw new Error('Nessun URL Google Sheets configurato (vedi Impostazioni).');
    // Content-Type text/plain evita il preflight CORS (Apps Script non gestisce OPTIONS)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Errore HTTP ${res.status}.`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }

  // ---------- ATTIVITÀ ----------
  async function fetchActivities() {
    const json = await apiGet('list');
    return json.activities || [];
  }

  async function addActivity(activity) {
    return apiPost({ action: 'addActivity', data: activity });
  }

  // ---------- BICI ----------
  async function fetchBikes() {
    const json = await apiGet('bikes');
    return json.bikes || [];
  }

  async function addBike(name) {
    name = (name || '').trim();
    if (!name) return;
    return apiPost({ action: 'addBike', name });
  }

  async function removeBike(name) {
    return apiPost({ action: 'removeBike', name });
  }

  // ---------- POSIZIONI COMUNI ----------
  async function fetchPositions() {
    const json = await apiGet('positions');
    return json.positions || {};
  }

  async function setPosition(name, lat, lon) {
    return apiPost({ action: 'setPosition', name, lat, lon });
  }

  async function resetPosition(name) {
    return apiPost({ action: 'resetPosition', name });
  }

  async function resetAllPositions() {
    return apiPost({ action: 'resetAllPositions' });
  }

  async function testConnection() {
    return apiGet('ping');
  }

  // ---------- STRAVA ----------
  async function stravaAuthUrl() {
    const json = await apiGet('stravaAuthUrl');
    return json.url;
  }

  async function stravaStatus() {
    const json = await apiGet('stravaStatus');
    return !!json.connected;
  }

  async function stravaSync() {
    const json = await apiGet('stravaSync');
    return json.activities || [];
  }

  return {
    getUrl, setUrl,
    fetchActivities, addActivity,
    fetchBikes, addBike, removeBike,
    fetchPositions, setPosition, resetPosition, resetAllPositions,
    testConnection,
    stravaAuthUrl, stravaStatus, stravaSync
  };
})();
