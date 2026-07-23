/**
 * app.js — logica principale dell'applicazione
 */

(() => {
  let ALL_COMUNI = [];
  let activitiesCache = [];

  // ---------- UTIL ----------
  function el(sel, root = document) { return root.querySelector(sel); }
  function els(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function showNotice(container, message, type = 'info') {
    container.style.display = 'block';
    container.className = `notice notice-${type}`;
    container.textContent = message;
  }
  function hideNotice(container) { container.style.display = 'none'; }

  // ---------- TABS ----------
  function initTabs() {
    els('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        els('.tab-btn').forEach(b => b.classList.remove('active'));
        els('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        el(`#tab-${btn.dataset.tab}`).classList.add('active');

        if (btn.dataset.tab === 'map') ensureMapInit();
        if (btn.dataset.tab === 'history') refreshHistory();
        if (btn.dataset.tab === 'manual') ensureManualForm();
      });
    });
  }

  // ---------- BIKES ----------
  async function refreshBikesUI() {
    const list = el('#bikesList');
    const datalist = el('#bikesDatalist');

    if (!SheetsApi.getUrl()) {
      list.innerHTML = '<span class="panel-sub" style="margin:0;">Collega prima Google Sheets in "Impostazioni" per gestire le bici.</span>';
      datalist.innerHTML = '';
      return;
    }

    try {
      const bikes = await SheetsApi.fetchBikes();
      datalist.innerHTML = bikes.map(b => `<option value="${escapeHtml(b)}">`).join('');
      list.innerHTML = bikes.length
        ? bikes.map(b => `
            <span class="bike-chip">${escapeHtml(b)}
              <button type="button" data-bike="${escapeHtml(b)}" aria-label="Rimuovi">✕</button>
            </span>`).join('')
        : '<span class="panel-sub" style="margin:0;">Nessuna bici salvata ancora.</span>';

      els('.bike-chip button', list).forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await SheetsApi.removeBike(btn.dataset.bike);
            await refreshBikesUI();
          } catch (err) {
            btn.disabled = false;
            list.insertAdjacentHTML('beforeend',
              `<div class="notice notice-error" style="width:100%; margin-top:8px;">Errore nella rimozione: ${escapeHtml(err.message)}</div>`);
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<span class="panel-sub" style="margin:0; color:var(--terracotta-dark);">Errore nel caricamento bici: ${escapeHtml(err.message)}</span>`;
    }

    refreshBikeSummaryUI();
  }

  function initBikesSettings() {
    const addBtn = el('#addBikeBtn');
    const input = el('#newBikeInput');

    async function submitNewBike() {
      const name = input.value.trim();
      if (!name) return;
      addBtn.disabled = true;
      try {
        await SheetsApi.addBike(name);
        input.value = '';
        await refreshBikesUI();
      } catch (err) {
        el('#bikesList').insertAdjacentHTML('beforeend',
          `<div class="notice notice-error" style="width:100%; margin-top:8px;">Errore nel salvataggio: ${escapeHtml(err.message)}</div>`);
      } finally {
        addBtn.disabled = false;
      }
    }

    addBtn.addEventListener('click', submitNewBike);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitNewBike(); }
    });
  }

  // ---------- SETTINGS ----------
  function initSettings() {
    el('#sheetsUrlInput').value = SheetsApi.getUrl();
    const status = el('#settingsStatus');

    el('#saveSheetsUrlBtn').addEventListener('click', () => {
      SheetsApi.setUrl(el('#sheetsUrlInput').value);
      showNotice(status, 'URL salvato. Vai su "Testa connessione" per verificarlo.', 'success');
    });

    el('#testSheetsUrlBtn').addEventListener('click', async () => {
      showNotice(status, 'Test in corso…', 'info');
      try {
        SheetsApi.setUrl(el('#sheetsUrlInput').value);
        await SheetsApi.testConnection();
        showNotice(status, 'Connessione riuscita! Il foglio Google Sheets risponde correttamente.', 'success');
        loadHomeData();
        refreshBikesUI();
        refreshStravaStatus();
      } catch (e) {
        showNotice(status, `Connessione non riuscita: ${e.message}`, 'error');
      }
    });
  }

  // ---------- STRAVA ----------
  let stravaOverridesCache = null; // posizioni comuni corrette, riusate per tutta la sincronizzazione

  async function refreshStravaStatus() {
    const statusText = el('#stravaStatusText');
    const connectBtn = el('#stravaConnectBtn');
    const syncBtn = el('#stravaSyncBtn');

    if (!SheetsApi.getUrl()) {
      statusText.textContent = 'Collega prima Google Sheets qui sopra.';
      connectBtn.style.display = 'none';
      syncBtn.style.display = 'none';
      return;
    }

    try {
      const connected = await SheetsApi.stravaStatus();
      statusText.textContent = connected ? 'Strava collegato ✓' : 'Strava non ancora collegato.';
      connectBtn.style.display = connected ? 'none' : 'inline-block';
      syncBtn.style.display = connected ? 'inline-block' : 'none';
    } catch (err) {
      statusText.textContent = `Errore nel verificare lo stato: ${err.message}`;
    }
  }

  function initStravaSettings() {
    const connectBtn = el('#stravaConnectBtn');
    const syncBtn = el('#stravaSyncBtn');
    const syncStatus = el('#stravaSyncStatus');

    connectBtn.addEventListener('click', async () => {
      try {
        const url = await SheetsApi.stravaAuthUrl();
        window.open(url, '_blank');
        showNotice(syncStatus,
          'Completa l\'autorizzazione nella scheda che si è aperta, poi torna qui e ricarica la pagina (o premi di nuovo "Impostazioni").',
          'info');
      } catch (err) {
        showNotice(syncStatus, `Errore: ${err.message}`, 'error');
      }
    });

    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      showNotice(syncStatus, 'Sincronizzazione in corso, può richiedere qualche secondo…', 'info');
      try {
        stravaOverridesCache = await SheetsApi.fetchPositions().catch(() => ({}));
        const activities = await SheetsApi.stravaSync();

        if (activities.length === 0) {
          showNotice(syncStatus, 'Nessuna nuova attività da importare: sei già aggiornato.', 'success');
        } else {
          let imported = 0;
          for (const a of activities) {
            try {
              await importStravaActivity(a);
              imported++;
              showNotice(syncStatus, `Importazione in corso… ${imported}/${activities.length}`, 'info');
            } catch (err) {
              // continua con le altre anche se una singola fallisce
            }
          }
          showNotice(syncStatus, `Importate ${imported} nuove attività da Strava su ${activities.length} trovate.`, 'success');
          refreshBikesUI();
          await loadHomeData();
        }
      } catch (err) {
        showNotice(syncStatus, `Errore nella sincronizzazione: ${err.message}`, 'error');
      } finally {
        syncBtn.disabled = false;
      }
    });

    refreshStravaStatus();
  }

  function deriveMomento(dateObj) {
    const h = dateObj.getHours();
    if (h >= 5 && h < 12) return 'mattino';
    if (h >= 12 && h < 18) return 'pomeriggio';
    if (h >= 18 && h < 22) return 'sera';
    return 'notte';
  }

  async function importStravaActivity(a) {
    const overrides = stravaOverridesCache || {};
    const comuniPoints = GpxParser.buildComuniPoints(overrides);
    const points = GpxParser.decodePolyline(a.polyline);
    const comuni = points.length
      ? GpxParser.detectComuniAttraversati(points, comuniPoints)
      : [];

    const partenza = (a.startLatLng && a.startLatLng.length === 2)
      ? GpxParser.nearestComune(a.startLatLng[0], a.startLatLng[1], comuniPoints).name
      : 'Sconosciuta';
    const arrivo = (a.endLatLng && a.endLatLng.length === 2)
      ? GpxParser.nearestComune(a.endLatLng[0], a.endLatLng[1], comuniPoints).name
      : 'Sconosciuto';

    const startDate = new Date(a.startDateLocal);
    const tipo = (a.workoutType === 11) ? 'gara' : 'allenamento';

    const activity = {
      data: isNaN(startDate) ? '' : startDate.toISOString().slice(0, 10),
      momento: isNaN(startDate) ? 'mattino' : deriveMomento(startDate),
      tipo,
      bici: a.gearName || '',
      partenza,
      arrivo,
      km: Math.round((a.distance / 1000) * 100) / 100,
      dislivello: Math.round(a.elevationGain || 0),
      tempoMovimento: GpxParser.formatHMS(a.movingTime || 0),
      durataTotale: GpxParser.formatHMS(a.elapsedTime || 0),
      note: a.name ? `Importato da Strava: ${a.name}` : 'Importato da Strava',
      comuni: comuni.join(', '),
      stravaId: a.stravaId
    };

    await SheetsApi.addActivity(activity);
    if (a.gearName) {
      try { await SheetsApi.addBike(a.gearName); } catch (e) { /* non bloccante */ }
    }
  }

  // ---------- CHIP INPUT (comuni attraversati) ----------
  function attachComuniChipInput(formEl, initial = []) {
    const wrap = el('[data-role="comuni-chip-input"]', formEl);
    const chipsEl = el('[data-role="chips"]', wrap);
    const searchEl = el('[data-role="chip-search"]', wrap);
    const suggEl = el('[data-role="chip-suggestions"]', formEl);

    let selected = [...initial];

    function render() {
      chipsEl.innerHTML = selected.map(name => `
        <span class="chip" data-name="${escapeHtml(name)}">
          ${escapeHtml(name)}
          <button type="button" aria-label="Rimuovi ${escapeHtml(name)}">✕</button>
        </span>
      `).join('');
      els('.chip button', chipsEl).forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.parentElement.dataset.name;
          selected = selected.filter(n => n !== name);
          render();
        });
      });
    }

    function renderSuggestions(query) {
      if (!query) { suggEl.innerHTML = ''; return; }
      const q = query.toLowerCase();
      const matches = ALL_COMUNI
        .filter(n => !selected.includes(n) && n.toLowerCase().includes(q))
        .slice(0, 8);
      suggEl.innerHTML = matches.map(n =>
        `<div class="chip-suggestion-item" data-name="${escapeHtml(n)}">${escapeHtml(n)}</div>`
      ).join('');
      els('.chip-suggestion-item', suggEl).forEach(item => {
        item.addEventListener('click', () => {
          selected.push(item.dataset.name);
          searchEl.value = '';
          suggEl.innerHTML = '';
          render();
          searchEl.focus();
        });
      });
    }

    searchEl.addEventListener('input', () => renderSuggestions(searchEl.value.trim()));
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = searchEl.value.trim();
        const exact = ALL_COMUNI.find(n => n.toLowerCase() === q.toLowerCase());
        if (exact && !selected.includes(exact)) {
          selected.push(exact);
          searchEl.value = '';
          suggEl.innerHTML = '';
          render();
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target) && !suggEl.contains(e.target)) suggEl.innerHTML = '';
    });

    render();
    return { getSelected: () => selected, setSelected: (arr) => { selected = [...arr]; render(); } };
  }

  // ---------- FORM ATTIVITÀ (indoor) ----------
  function buildActivityForm(container, { prefill = {}, comuniIniziali = [], indoor = false } = {}) {
    const tpl = el('#activityFormTemplate');
    container.innerHTML = '';
    const node = tpl.content.cloneNode(true);
    const form = el('.activity-form', node);

    // pre-compila i campi
    Object.entries(prefill).forEach(([key, value]) => {
      const field = form.elements[key];
      if (field && value !== undefined && value !== null) field.value = value;
    });

    const chipApi = attachComuniChipInput(form, comuniIniziali);

    const statusEl = el('[data-role="form-status"]', form);
    const resetBtn = el('[data-role="reset-btn"]', form);
    const submitBtn = el('[data-role="submit-btn"]', form);

    if (indoor) {
      ['partenza', 'arrivo', 'km', 'dislivello'].forEach(name => {
        const field = form.elements[name];
        if (!field) return;
        field.value = '';
        field.disabled = true;
        field.required = false;
      });

      const biciField = form.elements['bici'];
      if (biciField) {
        biciField.value = 'RULLI';
        biciField.disabled = true;
      }

      const chipSearch = el('[data-role="chip-search"]', form);
      const chipWrap = el('[data-role="comuni-chip-input"]', form);
      if (chipSearch) {
        chipSearch.disabled = true;
        chipSearch.placeholder = 'Non applicabile per attività indoor';
      }
      if (chipWrap) chipWrap.classList.add('chip-input-disabled');
    }

    resetBtn.addEventListener('click', () => {
      form.reset();
      chipApi.setSelected([]);
      statusEl.textContent = '';
      if (indoor) {
        const biciField = form.elements['bici'];
        if (biciField) biciField.value = 'RULLI';
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const comuni = chipApi.getSelected();
      if (!indoor && comuni.length === 0) {
        statusEl.textContent = 'Aggiungi almeno un comune attraversato.';
        statusEl.style.color = 'var(--terracotta-dark)';
        return;
      }

      const fd = new FormData(form);
      const activity = {
        data: fd.get('data'),
        momento: fd.get('momento'),
        tipo: fd.get('tipo'),
        bici: indoor ? 'RULLI' : (fd.get('bici') || ''),
        partenza: indoor ? '' : fd.get('partenza'),
        arrivo: indoor ? '' : fd.get('arrivo'),
        km: indoor ? 0 : parseFloat(fd.get('km')),
        dislivello: indoor ? 0 : (parseFloat(fd.get('dislivello')) || 0),
        tempoMovimento: fd.get('tempoMovimento'),
        durataTotale: fd.get('durataTotale'),
        note: fd.get('note') || '',
        comuni: comuni.join(', ')
      };

      submitBtn.disabled = true;
      statusEl.style.color = 'var(--ink-soft)';
      statusEl.textContent = 'Salvataggio su Google Sheets…';

      try {
        await SheetsApi.addActivity(activity);
        try { await SheetsApi.addBike(activity.bici || (fd.get('bici') || '')); } catch (e) { /* non bloccante */ }
        statusEl.style.color = '#2C5A2E';
        statusEl.textContent = 'Attività salvata correttamente ✓';
        form.reset();
        chipApi.setSelected([]);
        if (indoor) {
          const biciField = form.elements['bici'];
          if (biciField) biciField.value = 'RULLI';
        }
        refreshBikesUI();
        await loadHomeData();
      } catch (err) {
        statusEl.style.color = 'var(--terracotta-dark)';
        statusEl.textContent = `Errore nel salvataggio: ${err.message}`;
      } finally {
        submitBtn.disabled = false;
      }
    });

    container.appendChild(node);
    return { form, chipApi };
  }

  function ensureManualForm() {
    const container = el('#manualFormWrap');
    if (container.dataset.built) return;
    container.dataset.built = '1';
    buildActivityForm(container, {
      prefill: { data: new Date().toISOString().slice(0, 10) },
      comuniIniziali: [],
      indoor: true
    });
  }

  // ---------- MAPPA ----------
  let mapInitialized = false;
  let editModeActive = false;
  let currentMapYear = 'all';

  async function ensureMapInit() {
    if (mapInitialized) { setTimeout(() => CnMap && window.dispatchEvent(new Event('resize')), 50); return; }
    mapInitialized = true;

    const saveStatus = el('#mapSaveStatus');
    let positions = {};
    if (SheetsApi.getUrl()) {
      try {
        positions = await SheetsApi.fetchPositions();
      } catch (err) {
        showNotice(saveStatus, `Impossibile caricare le correzioni di posizione salvate: ${err.message}`, 'error');
      }
    } else {
      showNotice(saveStatus, 'Collega Google Sheets in "Impostazioni" per salvare le correzioni di posizione in modo permanente.', 'info');
    }

    CnMap.init('cnMap', positions);
    renderComuniList();
    applyVisitedToMap();
    updateOverrideCount();

    CnMap.onSelect((name) => highlightComuneInList(name));
    CnMap.onOverrideChange((count, status) => updateOverrideCount(status));
    CnMap.onSaveError((err, name) => {
      showNotice(saveStatus,
        `Errore nel salvataggio della posizione${name ? ' di ' + name : ''}: ${err.message}`,
        'error');
    });

    el('#yearFilter').addEventListener('change', (e) => {
      currentMapYear = e.target.value;
      applyVisitedToMap();
    });

    el('#toggleEditModeBtn').addEventListener('click', () => {
      if (!SheetsApi.getUrl()) {
        showNotice(saveStatus, 'Collega prima Google Sheets in "Impostazioni": senza foglio collegato le correzioni non potrebbero essere salvate.', 'error');
        return;
      }
      editModeActive = !editModeActive;
      CnMap.setEditMode(editModeActive);
      el('#toggleEditModeBtn').textContent = editModeActive ? 'Esci da modalità modifica' : 'Correggi posizioni';
      el('#toggleEditModeBtn').classList.toggle('btn-primary', editModeActive);
      el('#toggleEditModeBtn').classList.toggle('btn-secondary', !editModeActive);
      el('#editModeHint').style.display = editModeActive ? 'block' : 'none';
    });
  }

  function updateOverrideCount(status) {
    const n = CnMap.overrideCount();
    let txt = n > 0 ? `${n} posizion${n === 1 ? 'e corretta' : 'i corrette'} manualmente` : '';
    if (status === 'saving') txt += (txt ? ' · ' : '') + 'salvataggio…';
    el('#overrideCount').textContent = txt;
    if (status === 'saved') hideNotice(el('#mapSaveStatus'));
  }


  function renderComuniList() {
    const listEl = el('#comuniList');
    const names = CnMap.getAllNames();
    listEl.innerHTML = names.map(name => `
      <div class="comune-row" data-name="${escapeHtml(name)}">
        <span class="comune-dot"></span>${escapeHtml(name)}
      </div>
    `).join('');
    els('.comune-row', listEl).forEach(row => {
      row.addEventListener('click', () => CnMap.focusComune(row.dataset.name));
    });

    el('#comuniSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      els('.comune-row', listEl).forEach(row => {
        row.style.display = row.dataset.name.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  function highlightComuneInList(name) {
    const row = el(`.comune-row[data-name="${cssEscape(name)}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function applyVisitedToMap() {
    populateYearFilter();
    const visited = getVisitedComuniSet(currentMapYear);
    CnMap.setVisited([...visited]);
    els('#comuniList .comune-row').forEach(row => {
      row.classList.toggle('visited', visited.has(row.dataset.name));
    });
    updateYearStats(visited);
  }

  function activitiesForYear(year) {
    if (!year || year === 'all') return activitiesCache;
    return activitiesCache.filter(a => String(a.data || '').slice(0, 4) === String(year));
  }

  function getVisitedComuniSet(year) {
    const set = new Set();
    activitiesForYear(year).forEach(a => {
      String(a.comuni || '').split(',').map(s => s.trim()).filter(Boolean).forEach(c => set.add(c));
    });
    return set;
  }

  function populateYearFilter() {
    const sel = el('#yearFilter');
    const years = [...new Set(
      activitiesCache.map(a => String(a.data || '').slice(0, 4)).filter(Boolean)
    )].sort((a, b) => b.localeCompare(a));

    const previousValue = sel.value || currentMapYear;
    sel.innerHTML = '<option value="all">Tutti gli anni</option>' +
      years.map(y => `<option value="${y}">${y}</option>`).join('');

    sel.value = (previousValue === 'all' || years.includes(previousValue)) ? previousValue : 'all';
    currentMapYear = sel.value;
  }

  function updateYearStats(visited) {
    const yearActivities = activitiesForYear(currentMapYear);
    const totalKm = yearActivities.reduce((sum, a) => sum + (parseFloat(a.km) || 0), 0);
    const label = currentMapYear === 'all' ? 'in totale' : `nel ${currentMapYear}`;
    el('#yearStats').textContent =
      `${visited.size} comuni visitati su 247 · ${yearActivities.length} attività · ${Math.round(totalKm).toLocaleString('it-IT')} km ${label}`;
  }

  // ---------- STORICO ----------
  async function refreshHistory() {
    const status = el('#historyStatus');
    const tbody = el('#activitiesTableBody');
    showNotice(status, 'Caricamento attività dal foglio Google Sheets…', 'info');
    try {
      activitiesCache = await SheetsApi.fetchActivities();
      hideNotice(status);
      renderActivitiesTable();
      applyVisitedToMap();
      updateHomeStats();
    } catch (err) {
      showNotice(status, `Impossibile caricare lo storico: ${err.message}`, 'error');
      tbody.innerHTML = '';
    }
  }

  function renderActivitiesTable() {
    const tbody = el('#activitiesTableBody');
    if (activitiesCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--ink-soft); padding:24px;">Nessuna attività registrata ancora.</td></tr>`;
      return;
    }
    const sorted = [...activitiesCache].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    tbody.innerHTML = sorted.map(a => `
      <tr>
        <td>${escapeHtml(a.data || '')}</td>
        <td>${escapeHtml(capitalize(a.momento))}</td>
        <td>${escapeHtml(capitalize(a.tipo))}</td>
        <td>${escapeHtml(a.partenza || '')}</td>
        <td>${escapeHtml(a.arrivo || '')}</td>
        <td>${escapeHtml(String(a.km ?? ''))}</td>
        <td>${escapeHtml(String(a.dislivello ?? ''))}</td>
        <td>${escapeHtml(a.tempoMovimento || '')}</td>
        <td>${escapeHtml(a.durataTotale || '')}</td>
        <td>${escapeHtml(a.bici || '')}</td>
        <td>${escapeHtml(a.comuni || '')}</td>
      </tr>
    `).join('');
  }

  // ---------- RIEPILOGO PER BICI (home) ----------
  function parseHMSToSeconds(str) {
    if (!str) return 0;
    const parts = String(str).split(':').map(n => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.unshift(0);
    const [h, m, s] = parts.slice(-3);
    return h * 3600 + m * 60 + s;
  }

  async function refreshBikeSummaryUI() {
    const checksEl = el('#bikeSummaryChecks');
    const statsEl = el('#bikeSummaryStats');
    if (!checksEl) return;

    if (!SheetsApi.getUrl()) {
      checksEl.innerHTML = '<span class="panel-sub" style="margin:0;">Collega Google Sheets in "Impostazioni" per vedere il riepilogo per bici.</span>';
      statsEl.style.display = 'none';
      return;
    }

    let bikes;
    try {
      bikes = await SheetsApi.fetchBikes();
    } catch (err) {
      checksEl.innerHTML = `<span class="panel-sub" style="margin:0; color:var(--terracotta-dark);">Errore nel caricamento bici: ${escapeHtml(err.message)}</span>`;
      statsEl.style.display = 'none';
      return;
    }

    if (bikes.length === 0) {
      checksEl.innerHTML = '<span class="panel-sub" style="margin:0;">Nessuna bici salvata ancora (aggiungila in "Impostazioni").</span>';
      statsEl.style.display = 'none';
      return;
    }

    const previouslyChecked = new Set(
      els('input[type="checkbox"]', checksEl).filter(cb => cb.checked).map(cb => cb.value)
    );

    checksEl.innerHTML = bikes.map(b => `
      <label class="bike-check">
        <input type="checkbox" value="${escapeHtml(b)}" ${previouslyChecked.has(b) ? 'checked' : ''}>
        ${escapeHtml(b)}
      </label>
    `).join('');

    els('input[type="checkbox"]', checksEl).forEach(cb => {
      cb.addEventListener('change', updateBikeSummaryStats);
    });

    updateBikeSummaryStats();
  }

  function updateBikeSummaryStats() {
    const checksEl = el('#bikeSummaryChecks');
    const statsEl = el('#bikeSummaryStats');
    if (!checksEl || !statsEl) return;

    const selected = els('input[type="checkbox"]:checked', checksEl).map(cb => cb.value);
    if (selected.length === 0) {
      statsEl.style.display = 'none';
      return;
    }

    const selectedSet = new Set(selected);
    const matching = activitiesCache.filter(a => selectedSet.has(String(a.bici || '').trim()));

    const totalKm = matching.reduce((sum, a) => sum + (parseFloat(a.km) || 0), 0);
    const totalSeconds = matching.reduce((sum, a) => sum + parseHMSToSeconds(a.tempoMovimento), 0);
    const totalDislivello = matching.reduce((sum, a) => sum + (parseFloat(a.dislivello) || 0), 0);

    el('#bikeSummaryCount').textContent = matching.length;
    el('#bikeSummaryKm').textContent = Math.round(totalKm).toLocaleString('it-IT');
    el('#bikeSummaryTime').textContent = GpxParser.formatHMS(totalSeconds);
    el('#bikeSummaryDislivello').textContent = Math.round(totalDislivello).toLocaleString('it-IT');
    statsEl.style.display = 'flex';
  }

  // ---------- HOME ----------
  async function loadHomeData() {
    const status = el('#homeStatus');
    if (!SheetsApi.getUrl()) {
      showNotice(status, 'Nessun foglio Google Sheets collegato. Vai su "Impostazioni" per configurarlo.', 'info');
      return;
    }
    showNotice(status, 'Caricamento dati da Google Sheets…', 'info');
    try {
      activitiesCache = await SheetsApi.fetchActivities();
      hideNotice(status);
      updateHomeStats();
      if (mapInitialized) applyVisitedToMap();
    } catch (err) {
      showNotice(status, `Impossibile contattare il foglio Google Sheets: ${err.message}`, 'error');
    }
  }

  function updateHomeStats() {
    const visited = getVisitedComuniSet();
    const totalKm = activitiesCache.reduce((sum, a) => sum + (parseFloat(a.km) || 0), 0);

    el('#statComuniVisitati').textContent = visited.size;
    el('#statAttivita').textContent = activitiesCache.length;
    el('#statKm').textContent = Math.round(totalKm).toLocaleString('it-IT');

    const pct = Math.round((visited.size / 247) * 100);
    el('#progressFill').style.width = `${pct}%`;
    el('#progressPct').textContent = `${pct}%`;

    updateBikeSummaryStats();
  }

  // ---------- HELPERS ----------
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function cssEscape(str) {
    return String(str).replace(/["\\]/g, '\\$&');
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ---------- INIT ----------
  document.addEventListener('DOMContentLoaded', () => {
    ALL_COMUNI = CUNEO_COMUNI_GEOJSON.features.map(f => f.properties.name).sort((a, b) => a.localeCompare(b, 'it'));

    initTabs();
    initSettings();
    initBikesSettings();
    initStravaSettings();
    refreshBikesUI();
    loadHomeData();
  });
})();
