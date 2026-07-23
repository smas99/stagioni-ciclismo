# Granfondo Personale — provincia di Cuneo

Sito personale statico (HTML + CSS + JavaScript, nessun server necessario)
per tracciare le tue uscite in bici nella provincia di Cuneo: importi un
file GPX, il sito calcola km, tempi e comuni attraversati (in base alla
vicinanza del tracciato ai pallini sulla mappa) e li salva sul tuo Google
Sheet personale. La mappa colora di verde i comuni già "conquistati".

## Struttura del progetto

```
index.html              pagina principale (tutte le sezioni/tab)
css/style.css            grafica
js/comuni-data.js        confini geografici (GeoJSON) dei 247 comuni CN, dati ISTAT
js/gpx-parser.js         parsing GPX, calcolo statistiche, rilevamento comuni
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
2. Rilanciare la funzione `setup` una volta (crea i fogli "Bici" e
   "Posizioni" se non esistono ancora; da questa versione, estende anche in
   automatico le intestazioni di un foglio "Attivita" già esistente se
   mancano colonne più recenti — non serve più editarle a mano).
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
ricalcolati dal tracciato con lo stesso metodo dell'import GPX.

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

- **Importa GPX**: trascina o seleziona un file `.gpx`. Il sito calcola in
  automatico distanza, tempo in movimento (esclude le soste sotto i
  2,2 km/h), durata totale, luogo di partenza/arrivo e i comuni
  attraversati: un comune è considerato attraversato se il tracciato passa
  entro 800 metri dal suo pallino sulla mappa (se lo hai corretto
  manualmente, viene usata la posizione corretta). Puoi correggere qualsiasi
  campo prima di confermare.
- **Attività manuale**: stesso form, vuoto, per uscite senza traccia GPS.
  Cerca e aggiungi i comuni a mano.
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
  su qualsiasi dispositivo o browser tu usi in futuro. "Ripristina tutte le
  posizioni" annulla tutte le correzioni fatte; dal popup di un singolo
  comune puoi ripristinare solo quello.
- **Storico**: tabella di tutte le attività salvate sul foglio.
- **Impostazioni**: URL del foglio Google Sheets, collegamento Strava con
  sincronizzazione automatica (vedi sezione dedicata sopra), ed elenco delle
  tue bici (salvato anch'esso sul foglio, tab "Bici" — comodo
  autocompletamento nei form e visibile da qualunque dispositivo).

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
  posizioni" nella pagina Mappa), l'import GPX usa automaticamente quella
  posizione corretta invece di quella di default.
- Il "tempo in movimento" esclude i tratti in cui la velocità istantanea tra
  due punti scende sotto 2,2 km/h (soglia modificabile in `gpx-parser.js`,
  costante `STOP_SPEED_THRESHOLD`).
- Il dislivello positivo viene calcolato dalle quote del GPX, con una media
  mobile (3 punti) per attenuare il rumore dell'altimetro GPS e una soglia
  minima di 0,2 m tra punti smussati consecutivi per non sommare
  micro-oscillazioni come dislivello reale. Sono calibrati per seguire da
  vicino i saliscendi reali (specie quelli brevi e ravvicinati tipici delle
  Langhe) restando comunque tolleranti al rumore GPS; sono comunque una
  stima basata solo sulla quota del GPS, quindi meno precisa di servizi che
  usano un modello del terreno (Strava, Komoot). Modificabile in
  `gpx-parser.js`, costanti `ELEVATION_SMOOTHING_WINDOW` e
  `ELEVATION_NOISE_THRESHOLD_M` (aumentale se il dislivello ti risulta
  sovrastimato, diminuiscile se ancora sottostimato). Se il GPX non
  contiene quote, il campo va compilato a mano (il sito lo segnala).
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
