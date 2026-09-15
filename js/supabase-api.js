/**
 * supabase-api.js
 * Sostituisce sheets-api.js: stesso oggetto globale `SheetsApi`, stesse
 * funzioni pubbliche — ma il backend è Supabase (progetto "attivityBike")
 * invece di un Google Sheet + Apps Script. Così app.js, map.js,
 * tracce-map.js, routes-map.js e gpx-parser.js NON hanno bisogno di
 * nessuna modifica.
 *
 * La sincronizzazione Strava (OAuth + fetch attività) resta lato server,
 * ma ora è una Edge Function Supabase ("strava") invece di Code.gs:
 * i token restano nella tabella strava_config, mai esposta al browser.
 */

const SheetsApi = (() => {

  const SUPABASE_URL = 'https://xqarzmetdskdgwvkfhfm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_pLRoR7lZKyuMoiOym8Paug_X8Aw3u8W';
  const STRAVA_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/strava`;

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Non serve più configurare un URL: le credenziali sono già qui sopra.
  // Restano per compatibilità con app.js (che controlla "if (!SheetsApi.getUrl())").
  function getUrl() { return SUPABASE_URL; }
  function setUrl() { /* non necessario con Supabase */ }

  function throwIfError(error) {
    if (error) throw new Error(error.message || String(error));
  }

  // ---------- BICI ----------
  // Il "nome" mostrato nel sito per una bici è la colonna `descrizione`.
  async function fetchBikes() {
    const { data, error } = await client.from('bici').select('id, descrizione').order('descrizione');
    throwIfError(error);
    return (data || []).map(b => b.descrizione).filter(Boolean);
  }

  async function findBikeId(name) {
    const { data, error } = await client.from('bici').select('id').ilike('descrizione', name).maybeSingle();
    throwIfError(error);
    return data ? data.id : null;
  }

  async function addBike(name) {
    name = (name || '').trim();
    if (!name) return;
    const existingId = await findBikeId(name);
    if (existingId) return;
    const { error } = await client.from('bici').insert({ descrizione: name });
    throwIfError(error);
  }

  async function removeBike(name) {
    const { error } = await client.from('bici').delete().ilike('descrizione', name);
    throwIfError(error);
  }

  // ---------- POSIZIONI COMUNI ----------
  async function fetchPositions() {
    const { data, error } = await client.from('posizioni').select('comune, lat, lon');
    throwIfError(error);
    const positions = {};
    (data || []).forEach(r => {
      if (r.comune) positions[r.comune] = { lat: r.lat, lon: r.lon };
    });
    return positions;
  }

  async function setPosition(name, lat, lon) {
    const { error } = await client
      .from('posizioni')
      .upsert({ comune: name, lat, lon }, { onConflict: 'comune' });
    throwIfError(error);
  }

  async function resetPosition(name) {
    const { error } = await client.from('posizioni').delete().eq('comune', name);
    throwIfError(error);
  }

  // ---------- TRACCE (percorsi GPS) ----------
  async function fetchTraccePolylineMap() {
    const { data, error } = await client.from('tracce').select('stravaId, polyline');
    throwIfError(error);
    const map = {};
    (data || []).forEach(t => { map[String(t.stravaId)] = t.polyline; });
    return map;
  }

  async function fetchTracce() {
    const { data, error } = await client.from('tracce').select('stravaId, polyline');
    throwIfError(error);
    return data || [];
  }

  async function upsertTraccia(stravaId, polyline) {
    if (!stravaId || !polyline) return;
    const { error } = await client
      .from('tracce')
      .upsert({ stravaId: String(stravaId), polyline }, { onConflict: 'stravaId' });
    throwIfError(error);
  }

  // ---------- ATTIVITÀ ----------
  async function fetchActivities() {
    const { data, error } = await client
      .from('attivita')
      .select('id, data, momento, tipo, partenza, arrivo, km, dislivello, tempoMovim, durataTotale, comuni, note, stravaId, idbici, bici(descrizione)')
      .order('data', { ascending: false });
    throwIfError(error);

    const polylineByStravaId = await fetchTraccePolylineMap();

    return (data || []).map(r => ({
      id: r.id,
      data: r.data || '',
      momento: r.momento || '',
      tipo: r.tipo || '',
      partenza: r.partenza || '',
      arrivo: r.arrivo || '',
      km: r.km,
      dislivello: r.dislivello,
      tempoMovimento: r.tempoMovim || '',
      durataTotale: r.durataTotale || '',
      bici: (r.bici && r.bici.descrizione) || '',
      comuni: r.comuni || '',
      note: r.note || '',
      stravaId: r.stravaId || '',
      polyline: r.stravaId ? (polylineByStravaId[String(r.stravaId)] || '') : ''
    }));
  }

  async function addActivity(activity) {
    let idbici = null;
    if (activity.bici) {
      idbici = await findBikeId(activity.bici);
      if (!idbici) {
        const { data, error } = await client.from('bici').insert({ descrizione: activity.bici }).select('id').single();
        throwIfError(error);
        idbici = data.id;
      }
    }

    const row = {
      data: activity.data || null,
      momento: activity.momento || '',
      tipo: activity.tipo || '',
      partenza: activity.partenza || '',
      arrivo: activity.arrivo || '',
      km: (typeof activity.km === 'number') ? activity.km : parseFloat(activity.km) || 0,
      dislivello: (typeof activity.dislivello === 'number') ? activity.dislivello : parseFloat(activity.dislivello) || 0,
      tempoMovim: activity.tempoMovimento || '',
      durataTotale: activity.durataTotale || '',
      idbici,
      comuni: activity.comuni || '',
      note: activity.note || '',
      stravaId: activity.stravaId || null
    };

    const { data, error } = await client.from('attivita').insert(row).select('id').single();
    throwIfError(error);

    if (activity.polyline && activity.stravaId) {
      await upsertTraccia(activity.stravaId, activity.polyline);
    }

    return { ok: true, id: data.id };
  }

  // ---------- CONNESSIONE ----------
  async function testConnection() {
    const { error } = await client.from('bici').select('id', { count: 'exact', head: true });
    throwIfError(error);
    return { ok: true };
  }

  // ---------- STRAVA (via Edge Function) ----------
  async function stravaApiGet(action) {
    const res = await fetch(`${STRAVA_FUNCTION_URL}?action=${encodeURIComponent(action)}`);
    if (!res.ok) throw new Error(`Errore HTTP ${res.status}.`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }

  async function stravaAuthUrl() {
    const json = await stravaApiGet('stravaAuthUrl');
    return json.url;
  }

  async function stravaStatus() {
    const json = await stravaApiGet('stravaStatus');
    return !!json.connected;
  }

  async function stravaSync() {
    const json = await stravaApiGet('stravaSync');
    return json.activities || [];
  }

  // ---------- ZONA PRIVACY ----------
  // Funzionalità non ancora migrata (sezione già nascosta nell'interfaccia):
  // ritorna sempre "non attiva" finché non viene ricreata lato Edge Function.
  async function privacyZoneStatus() {
    return { active: false, radiusM: null };
  }

  return {
    getUrl, setUrl,
    fetchActivities, addActivity,
    fetchBikes, addBike, removeBike,
    fetchPositions, setPosition, resetPosition,
    testConnection,
    fetchTracce,
    stravaAuthUrl, stravaStatus, stravaSync,
    privacyZoneStatus
  };
})();
