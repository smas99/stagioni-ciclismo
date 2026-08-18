# Nei 247 comuni della provincia di Cuneo

Sito personale statico (HTML + CSS + JavaScript, nessun server necessario)
per tracciare le tue uscite in bici nella provincia di Cuneo: le uscite
arrivano da Strava (sincronizzazione automatica) o si registrano a mano
come attività indoor sui rulli; il sito calcola/riceve km, tempi e comuni
attraversati (in base alla vicinanza del tracciato ai pallini sulla mappa)
e li salva sul tuo Google Sheet personale. La mappa colora di verde i
comuni già "conquistati".

## Struttura del progetto

```
index.html              pagina principale (tutte le sezioni/tab)
css/style.css            grafica
js/comuni-data.js        confini geografici (GeoJSON) dei 247 comuni CN, dati ISTAT
js/gpx-parser.js         calcolo distanze, rilevamento comuni per prossimità (usato dalla sincronizzazione Strava)
js/sheets-api.js         comunicazione con Google Sheets
js/map.js                mappa Leaflet
js/app.js                logica dell'interfaccia
apps-script/Code.gs      backend da incollare in Google Apps Script
```

## Aggiornamento da una versione precedente

Se stavi già usando una versione del sito in cui bici e correzioni di
posizione erano salvate solo nel browser (localStorage), questa versione le
sposta sul foglio Google Sheets. Sono due sistemi separati: **i vecchi dati
locali non vengono migrati automaticamente**. Se ne avevi già inseriti,
dovrai re-inserirli una volta tramite l'interfaccia (poche righe da
ridigitare) — da quel momento in poi resteranno salvati sul foglio e
visibili da qualsiasi dispositivo. Ricordati anche di:
1. Sostituire `Code.gs` con la nuova versione nell'editor Apps Script.
2. Rilanciare la funzione `setup` una volta (crea i fogli "Bici",
   "Posizioni" e "Tracce" se non esistono ancora; da questa versione,
   estende anche in automatico le intestazioni di un foglio "Attivita" già
   esistente se mancano colonne più recenti — non serve più editarle a
   mano).
3. **Gestisci distribuzioni → matita (modifica) → Nuova versione → Esegui
   la distribuzione**, altrimenti l'URL `/exec` resta congelato al codice
   vecchio.

## 1. Collegare Google Sheets (10 minuti, una volta sola)

1. Vai su [sheets.google.com](https://sheets.google.com) e crea un foglio
   nuovo vuoto (es. "Granfondo Cuneo — Dati").
2. Menu **Estensioni → Apps Script**.
3. Cancella il codice di esempio presente e incolla **tutto** il contenuto
   del file `apps-script/Code.gs` di questo progetto.
4. Salva il progetto (icona a forma di dischetto), dagli un nome a piacere.
5. Nella barra in alto, scegli la funzione `setup` dal menu a tendina delle
   funzioni ed esegui (▶). La prima volta Google chiederà di autorizzare gli
   accessi al tuo foglio: accetta (è il tuo script, sul tuo foglio).
   Questo crea automaticamente i tre fogli necessari ("Attivita", "Bici",
   "Posizioni") con le intestazioni corrette.
6. Menu **Esegui la distribuzione → Nuova distribuzione**.
   - Tipo: **App web**
   - Descrizione: a piacere
   - Esegui come: **Me**
   - Chi ha accesso: **Chiunque**
     *(necessario: il sito è statico e chiama l'URL direttamente dal
     browser, senza login Google. I dati restano comunque privati: solo chi
     conosce l'URL segreto della tua web app può leggerli/scriverli.)*
7. Clicca **Esegui la distribuzione**, copia l'**URL app web** (termina con
   `/exec`).
8. Apri `index.html` nel browser, vai su **Impostazioni**, incolla l'URL e
   premi **Salva**, poi **Testa connessione**.

Se in futuro modifichi `Code.gs`, ricordati di fare **Gestisci distribuzioni
→ modifica (matita) → Nuova versione → Esegui la distribuzione**, altrimenti
le modifiche non hanno effetto sulla web app pubblicata.

## 2. Collegare Strava (facoltativo, 10 minuti, una volta sola)

Con Strava collegato, in Impostazioni compare un pulsante **"Sincronizza
ora"**: importa in automatico tutte le tue nuove uscite in bici (niente
conferma manuale attività per attività). Km, dislivello e tempi arrivano
direttamente da Strava; comuni attraversati/partenza/arrivo vengono
ricalcolati dal tracciato con lo stesso metodo di rilevamento a prossimità
usato per la mappa (vedi "Note tecniche" più sotto).

1. Vai su [strava.com/settings/api](https://www.strava.com/settings/api) e
   crea un'applicazione ("My API Application"):
   - Nome applicazione: a piacere (es. "Granfondo Cuneo")
   - Categoria: a piacere
   - Website: metti l'URL del tuo sito se lo hai pubblicato, altrimenti
     `http://localhost`
   - **Authorization Callback Domain**: scrivi esattamente `script.google.com`
     (senza `https://`, senza percorso — è il dominio del tuo Apps Script,
     non quello del sito)
2. Crea l'applicazione. Nella pagina che si apre trovi **Client ID** e
   **Client Secret**.
3. Torna nell'editor Apps Script (Estensioni → Apps Script sul tuo Google
   Sheet). Clicca l'icona a **ingranaggio "Impostazioni progetto"** nel menu
   a sinistra, scorri fino a **"Proprietà dello script"** e aggiungi due
   proprietà:
   - `STRAVA_CLIENT_ID` → il Client ID copiato da Strava
   - `STRAVA_CLIENT_SECRET` → il Client Secret copiato da Strava
4. **Passaggio importante, facile da dimenticare**: nel menu a tendina delle
   funzioni in alto (lo stesso di `setup`), seleziona
   **`authorizeExternalRequests`** e premi **▶ Esegui**. Ti chiederà di
   autorizzare un nuovo permesso ("effettuare richieste a servizi esterni"):
   accetta (Rivedi le autorizzazioni → il tuo account → Avanzate → Vai al
   progetto (non sicuro) → Consenti). Senza questo passaggio, il
   collegamento con Strava fallisce con un errore di autorizzazione mancante
   anche se hai già fatto tutto il resto correttamente.
5. Se non l'hai già fatto per un aggiornamento precedente, rifai **Gestisci
   distribuzioni → matita → Nuova versione → Esegui la distribuzione**
   (le proprietà dello script non richiedono una nuova versione, ma il
   codice di questa guida sì, se non l'avevi già pubblicato).
6. Apri il sito (anche in locale va bene) → **Impostazioni** → **Collega
   Strava**. Si apre una scheda di Strava che ti chiede di autorizzare
   l'app: accetta.
7. Torna alla scheda del sito, ricarica la pagina (o vai su Impostazioni),
   e dovresti vedere "Strava collegato ✓" con il pulsante **"Sincronizza
   ora"**.
8. Premi **"Sincronizza ora"**: la prima volta importa tutto lo storico
   disponibile (fino a un tetto di sicurezza di circa 600 attività — vedi
   nota tecnica più sotto se ne hai di più), le volte successive solo le
   uscite nuove da quando hai sincronizzato l'ultima volta.

**Nota sulla precisione automatica:** il tipo attività (gara/allenamento) è
dedotto da un campo interno di Strava e potrebbe non essere sempre esatto;
può essere corretto direttamente nel foglio Google Sheets, cella per cella,
senza bisogno di reimportare.

## 3. Usare il sito

Apri semplicemente `index.html` con doppio clic (o "Apri con → browser").
Non serve alcun server web: tutto funziona come file locale, tranne le
chiamate a Google Sheets (richiede connessione internet) e le mappe
(tessere OpenStreetMap, richiede internet).

- **Home**: statistiche generali (comuni visitati, attività, km) e un
  filtro "Filtro per bici": seleziona una o più bici dall'elenco per vedere
  numero di attività, km, tempo in bici e dislivello totalizzati solo per
  quelle bici.
- **Attività indoor**: form per le uscite sui rulli. Niente percorso, km,
  dislivello o comuni attraversati (campi disattivati e vuoti): la bici è
  fissa su "RULLI". Utile per tenere lo storico completo delle ore in
  bici anche quando non si pedala all'aperto, senza che queste sessioni
  contino verso i comuni "conquistati".
- **Mappa provincia**: 247 pallini, uno per comune. Rosso = mai visitato,
  verde = presente in almeno un'attività salvata. In alto trovi un menu a
  tendina **"Anno"**: selezionandolo, i pallini verdi e le statistiche sotto
  ("comuni visitati", "attività", "km") si aggiornano per mostrare solo
  quell'anno; scegliendo "Tutti gli anni" torni alla vista cumulativa. Utile
  per rivedere anno per anno come si è "colorata" la provincia nel tempo.
  L'elenco a fianco è cercabile e cliccabile. Le coordinate di partenza sono calcolate
  automaticamente dai confini ISTAT e non sempre coincidono col centro
  abitato: premendo **"Correggi posizioni"** puoi trascinare qualsiasi
  pallino nella posizione giusta. La correzione si salva sul foglio Google
  Sheets "Posizioni" (richiede Google Sheets collegato), quindi resta valida
  su qualsiasi dispositivo o browser tu usi in futuro. Dal popup di un
  singolo comune puoi ripristinare la sua posizione originale in qualsiasi
  momento.
- **Percorsi**: mappa dei tracciati GPS delle uscite sincronizzate da
  Strava. Puoi nascondere il tratto di ogni percorso vicino a un punto (es.
  casa), sia in partenza sia in arrivo — vedi "Zona privacy nei percorsi"
  più sotto. Se non la configuri, i percorsi si vedono per intero.
- **Storico**: tabella di tutte le attività salvate sul foglio.
- **Impostazioni**: URL del foglio Google Sheets, collegamento Strava con
  sincronizzazione automatica (vedi sezione dedicata sopra), stato (sola
  lettura) della zona privacy percorsi, ed elenco delle tue bici (salvato
  anch'esso sul foglio, tab "Bici" — comodo autocompletamento nei form e
  visibile da qualunque dispositivo).

## Zona privacy nei percorsi (facoltativo)

Se condividi il link del sito con altre persone, o semplicemente non vuoi
che chiunque veda dove abiti, puoi far sì che il tratto di ogni percorso
entro un certo raggio da un punto (tipicamente casa) non venga **mai**
disegnato sulla mappa "Percorsi" — né in partenza né in arrivo. Il taglio
avviene **lato server** (nel tuo Apps Script), prima che il tracciato esca
verso qualsiasi browser: chiunque apra il link, da qualunque dispositivo,
riceve già il percorso tagliato. Nessuna configurazione lato sito: il punto
esatto non deve mai transitare dal client, altrimenti chiunque potrebbe
vederlo (inclusi eventuali strumenti di sviluppo del browser).

1. Trova le coordinate del punto che vuoi nascondere (es. cerca il tuo
   indirizzo su [Google Maps](https://maps.google.com), tasto destro sul
   punto esatto → il primo valore in alto è "lat, lon").
2. Apri l'editor Apps Script del tuo Google Sheet (Estensioni → Apps
   Script), icona **ingranaggio "Impostazioni progetto"** nel menu a
   sinistra, scorri fino a **"Proprietà dello script"** e aggiungi tre
   proprietà:
   - `PRIVACY_ZONE_LAT` → la latitudine (es. `44.4056`)
   - `PRIVACY_ZONE_LON` → la longitudine (es. `7.5432`)
   - `PRIVACY_ZONE_RADIUS_M` → il raggio in metri da nascondere (es. `400`)
3. Non serve nessuna nuova distribuzione per questo passaggio: le proprietà
   dello script vengono lette a ogni chiamata, effetto immediato.
4. In **Impostazioni → "Zona privacy nei percorsi"** sul sito, lo stato
   diventa "Zona privacy attiva: raggio 400 m…" — conferma solo che è
   attiva e il raggio, mai le coordinate, anche a chi visita il sito senza
   avere accesso al tuo Apps Script.
5. Per disattivarla, rimuovi le tre proprietà (o svuotane il valore) dallo
   stesso pannello.

Se un intero percorso ricade nella zona (es. un giretto breve nei dintorni
di casa), quel percorso non compare affatto nella scheda Percorsi — non
solo il tratto vicino al punto.

## Note tecniche

- I confini dei 247 comuni provengono dai dati ufficiali ISTAT (limiti
  amministrativi generalizzati), tramite il dataset pubblico
  [openpolis/geojson-italy](https://github.com/openpolis/geojson-italy)
  (licenza CC-BY), convertiti in GeoJSON e incorporati in `js/comuni-data.js`.
  Sono usati per disegnare i confini sottili sulla mappa; il punto
  rappresentativo di ciascun comune (il pallino) è invece quello usato per
  il rilevamento.
- Il rilevamento dei comuni attraversati è a **prossimità**: un comune
  risulta attraversato se il tracciato passa entro **800 metri** (linea
  d'aria) dal suo pallino sulla mappa, campionando il tracciato ogni ~150
  metri per un buon compromesso tra precisione e velocità. La soglia di
  800 m è modificabile in `gpx-parser.js`, costante `MARKER_PROXIMITY_M`.
  Se hai corretto manualmente la posizione di un comune (vedi "Correggi
  posizioni" nella pagina Mappa), la sincronizzazione Strava usa
  automaticamente quella posizione corretta invece di quella di default.
- Nessuna chiave API richiesta: la mappa usa tessere OpenStreetMap
  pubbliche, la scrittura dati usa la tua web app Apps Script personale.
- **Strava**: il collegamento usa OAuth2 standard; client ID/secret e i
  token di accesso restano sempre lato server (Proprietà dello script di
  Apps Script), mai nel browser. La sincronizzazione filtra solo attività
  di ciclismo (Ride, VirtualRide, GravelRide, MountainBikeRide, ecc.),
  evita duplicati confrontando l'id Strava di ogni attività (colonna
  `stravaId`, in fondo al foglio "Attivita"), e si ferma dopo circa 600
  attività per sincronizzazione (costante `MAX_STRAVA_SYNC_PAGES` in
  `Code.gs`) per stare dentro ai limiti di tempo di esecuzione di Apps
  Script: se hai più storico di così, premi di nuovo "Sincronizza ora"
  qualche volta finché non trova più nulla di nuovo da importare.
  Il tracciato usato per rilevare i comuni è la `summary_polyline` fornita
  da Strava (precisione sufficiente per il raggio di 800 m, ma meno
  dettagliata di un GPX scaricato per intero).

## Idee per estensioni future

Alcuni suggerimenti se vorrai ampliare il progetto:
- Grafico storico km/mese o dislivello totale accumulato (il dislivello per
  singola attività è già salvato: basterebbe sommarlo lato client).
- Badge per zone (es. "tutte le valli Alpi Marittime completate").
- Esportazione dello storico in Excel/CSV direttamente dal sito (oltre a
  Google Sheets, che è già esportabile in `.xlsx` da Google Drive con
  File → Scarica → Microsoft Excel).
- Autenticazione se in futuro vorrai pubblicare il sito online e proteggere
  la scrittura dei dati (oggi, usandolo solo in locale, non è necessaria).
