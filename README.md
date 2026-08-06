# Ancorhash — Environmental Compliance & Web3 Notarizer

**Verbali ambientali a prova di manomissione. Hash calcolato in locale, ancoraggio su blockchain, parametri di campo estratti con l'AI.**

[![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Azure AI](https://img.shields.io/badge/Azure%20AI-0078D4?logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/en-us/products/ai-services/ai-document-intelligence)
[![Polygon](https://img.shields.io/badge/Polygon-7B3FE4?logo=polygon&logoColor=white)](https://polygon.technology/)

> **Branch verticale.** Questo branch (`feature/azure-ai-water-sampling`) è la declinazione per la compliance ambientale, costruita attorno al *Verbale di campionamento acque superficiali*. La piattaforma Enterprise generica vive su [`main`](../../tree/main).

---

## Il problema

Il monitoraggio ambientale viaggia ancora sulla carta. Un verbale di campionamento viene compilato a mano sulla sponda del fiume, scansionato, spedito via email e archiviato — e questa catena ha due debolezze strutturali.

**1. Il documento è alterabile dopo la compilazione.**
Un verbale di campionamento è un atto: certifica come si presentava un tratto di corso d'acqua in una data e a un'ora precise. Tra il campo e l'archivio non esiste alcuna garanzia crittografica che un valore di pH non sia stato corretto, una data spostata, una pagina sostituita. Quando un verbale diventa prova in un contenzioso sugli scarichi di una discarica, è esattamente la sua integrità a essere contestata — e non c'è modo di dimostrarla.

**2. I dati restano prigionieri della carta.**
I parametri misurati — temperatura dell'acqua, pH, ossigeno disciolto — vengono scritti dentro caselle prestampate, una cifra per casella. Per arrivare al gestionale che dovrebbe sorvegliarli, qualcuno deve ridigitarli a mano. Questo significa ritardo (giorni tra il prelievo e l'inserimento a sistema), costo ed errori di trascrizione proprio sui valori che rivelerebbero un problema. Un'ossigenazione di 2,1 mg/l è un allarme ambientale; ferma dentro un PDF in una cartella condivisa, non è assolutamente nulla.

---

## La soluzione

Due capacità indipendenti, deliberatamente disaccoppiate: una garantisce il documento, l'altra ne libera il contenuto.

### 1. Ancoraggio Web3 Zero-Data-Leakage

L'hash SHA-256 del verbale viene calcolato **dentro il browser**, tramite la Web Crypto API nativa. Al backend viene inviata solo quell'impronta da 32 byte, che viene ancorata nel campo `data` di una transazione EIP-1559 su Polygon (o su qualunque rete EVM configurata).

Il documento non lascia mai il dispositivo dell'operatore. È un punto che va oltre l'igiene sulla privacy: i verbali riportano il nominativo del prelevatore, degli operatori e del sito — dati personali e commercialmente sensibili che un ente pubblico non può riversare con leggerezza su un cloud di terze parti. L'ancoraggio dell'hash produce una prova di esistenza pubblica, marcata temporalmente e immutabile, mentre il file resta dove deve stare.

La verifica è simmetrica e non richiede di fidarsi di noi: si ricalcola l'hash del file e lo si confronta con il valore on-chain. Se è cambiato anche un solo byte, i due hash divergono.

L'organizzazione non tocca mai un wallet, una chiave privata o un token: il backend agisce da **relayer gas-sponsored**, firmando e pagando la transazione. Una notarizzazione su Polygon mainnet costa oggi circa **$0,0008** di gas — misurato dal vivo combinando una stima on-chain del gas con un oracolo di prezzo CoinGecko.

### 2. AI Document Intelligence — dalla carta al dato azionabile

Quando l'operatore presta esplicitamente il consenso, il documento viene inviato ad **Azure AI Document Intelligence** e un parser di dominio ne estrae i parametri di campo come valori tipizzati:

| Campo | Tipo | Riferimento stampato sul modulo |
|---|---|---|
| Corso d'acqua | `string` | — |
| Data di prelievo | `date` | — |
| Temperatura acqua | `decimal` °C | limite 21,5 °C (salmonicole) / 28,0 °C (ciprinicole) |
| pH | `decimal` | valori normali 7,8 – 8,8 |
| Ossigeno disciolto | `decimal` mg/l | valori normali 9,0 – 12,0 |

Poiché l'output è **fortemente tipizzato** — un `decimal` pari a 4.2, non la stringa `"|0| |4|, |2|"` — il gestionale ricevente può confrontarlo con una soglia nell'istante stesso in cui il verbale viene caricato. È questo che rende possibile l'allarme ambientale: un pH di 4,2 su un corso d'acqua acidificato, o un ossigeno disciolto a 2,1 mg/l contro un minimo di 9,0, diventa un segnale leggibile da una macchina in pochi secondi dal prelievo, invece che una riga notata settimane dopo durante l'inserimento manuale.

> **Perimetro, detto chiaramente.** Questo branch consegna l'estrazione e il contratto dati tipizzato. La valutazione delle soglie e l'inoltro degli allarmi restano intenzionalmente al sistema ricevente (Power Platform / Dataverse), dove già vivono le regole di escalation e i destinatari. L'API consegna dati puliti pronti per quel passaggio — non implementa l'allarme.

**Il compromesso sul consenso è esplicito nell'interfaccia.** L'ancoraggio è sempre a zero fuga di dati; l'estrazione no, perché l'OCR ha bisogno del file. Per questo l'analisi è rigorosamente opt-in, disattivata di default, con una casella che dichiara che il documento verrà inviato al cloud. Se l'operatore la rifiuta il flusso funziona comunque — ottiene l'hash e la prova on-chain — e la scheda riporta *«Analisi AI disabilitata per tutelare la privacy. Il documento non ha mai lasciato questo dispositivo.»*

---

## Interpretare un modulo reale è più difficile di quanto sembri

Il modello ARPAL non è un form digitale pulito, e il parser è tarato sull'output OCR di un verbale realmente compilato, non su un caso ideale:

- **Una casella per cifra.** Il modulo stampa `|_| |_|, |_|` e l'OCR restituisce `|2| |0|, |5|` — a volte con spazi spuri dentro le caselle. Una fase di normalizzazione ricompone queste sequenze in `20,5` prima che venga applicata qualunque regola.
- **Glifi Unicode per le unità.** Azure restituisce `℃` (U+2103, carattere singolo), non `°C`.
- **Valori che vanno a capo.** `Corso d'acqua Torrente` chiude una riga e `Polcevera` apre la successiva; il valore viene letto attraverso l'interruzione, fino all'etichetta successiva del modulo.
- **Virgola decimale italiana**, interpretata con cultura invariante dopo la normalizzazione.
- **Trappole di prossimità, escluse deliberatamente:** `Temperatura aria` e `Temperatura sonda` stanno accanto a `Temperatura acqua`; la `%` di saturazione sta accanto alla concentrazione in `mg/l`; il piè di pagina porta una data di revisione `rev00 del 10/11/2022`; e tre pagine di istruzioni per la compilazione citano valori d'esempio come *«valori normali 7,8-8,8 U pH»*. Ogni regola è ancorata in modo che nessuno di questi venga mai scambiato per una misura.
- **I moduli in bianco restano in bianco.** Le caselle segnaposto non contengono cifre, quindi un modello non compilato produce `null` su ogni campo e `has_any_value: false` — l'assenza di un valore viene riportata come tale, mai inventata.

Ogni numero estratto è inoltre sottoposto a un controllo di plausibilità fisica (pH 0–14, temperatura −5…60 °C, ossigeno 0–30 mg/l): un valore fuori scala viene trattato come artefatto dell'OCR e scartato, anziché mostrato.

---

## Architettura di sistema

~~~mermaid
graph LR
    OP["Operatore in campo"] -->|"Carica il verbale"| BROWSER["<b>Frontend React</b><br/><i>SHA-256 locale</i>"]

    BROWSER -.->|"Solo con consenso"| API2["<b>Backend .NET 10</b><br/><i>/api/v1/extract</i>"]
    API2 --> AZURE["<b>Azure AI</b><br/><i>Document Intelligence</i>"]
    API2 --> PARSER["<b>Parser di dominio</b><br/><i>Parametri di campo</i>"]

    BROWSER -->|"Solo hash"| API["<b>Backend .NET 10</b><br/><i>/api/v1/notarize</i>"]
    API -->|"EIP-1559 gas-sponsored"| CHAIN["<b>Polygon / EVM</b><br/><i>Prova immutabile</i>"]
    PARSER -.->|"JSON tipizzato"| ERP["<b>Gestionale</b><br/><i>Soglie e allarmi</i>"]

    style BROWSER fill:#20232a,stroke:#61dafb,color:#fff
    style API fill:#512bd4,stroke:#512bd4,color:#fff
    style API2 fill:#512bd4,stroke:#512bd4,color:#fff
    style AZURE fill:#0078D4,stroke:#0078D4,color:#fff
    style CHAIN fill:#7B3FE4,stroke:#7B3FE4,color:#fff
    style ERP fill:#107C10,stroke:#107C10,color:#fff
~~~

### Il flusso di compliance

~~~mermaid
sequenceDiagram
    participant B as Frontend React
    participant A as Backend .NET
    participant Z as Azure AI
    participant R as Nodo Polygon

    B->>B: Calcola SHA-256 in locale (il file non viene caricato)
    opt L'operatore acconsente all'analisi AI
        B->>A: POST /api/v1/extract (multipart)
        A->>Z: Analisi (prebuilt-layout + coppie chiave-valore)
        Z-->>A: Testo OCR + campi del modulo
        A->>A: Parser di dominio -> parametri tipizzati
        A-->>B: field_data (corso d'acqua, data, T, pH, O2)
    end
    B->>A: POST /api/v1/notarize (hash, chain_id, token anti-bot)
    A->>A: Rate limit per IP + validazione Turnstile
    A->>R: Broadcast transazione EIP-1559 (data = hash)
    R-->>A: Transaction hash
    A-->>B: Prova on-chain + link al block explorer
~~~

---

## Stack tecnologico

### Backend — C# .NET 10, Azure Functions Isolated
Clean Architecture su `Ancorhash.Api` / `Ancorhash.Core` / `Ancorhash.Infrastructure`.
- **Estrazione AI:** `Azure.AI.DocumentIntelligence` (`prebuilt-layout` con la feature key-value pairs). L'autenticazione è **keyless** tramite `DefaultAzureCredential` / Managed Identity — nessuna chiave API in configurazione per impostazione predefinita.
- **Parsing di dominio:** `WaterSamplingReportParser` vive in `Core` senza alcuna dipendenza esterna — logica di business pura e testabile. Legge da due fonti, il testo OCR e le coppie chiave-valore di Azure, perché nei documenti-modulo il valore finisce spesso in una cella staccata dalla propria etichetta.
- **Blockchain:** `Nethereum`, transazioni EIP-1559, multi-chain per configurazione (un `Dictionary<int, NetworkConfig>` indicizzato per chain id EIP-155), con cache di un `IWeb3` per rete.
- **Segreti:** la chiave privata del relayer è risolta da **Azure Key Vault** attraverso la pipeline di configurazione; nulla di sensibile nel codice o nel repository.
- **Sicurezza:** validazione server-side di Cloudflare Turnstile (fail-closed) e rate limiting per IP sull'endpoint di notarizzazione, a protezione del wallet che sponsorizza il gas.
- **Osservabilità:** OpenTelemetry, logging strutturato su tutto il percorso.

### Frontend — React, TypeScript, Vite, Tailwind CSS
- **Hashing locale:** `crypto.subtle.digest` — nessuna libreria crittografica di terze parti.
- **Scheda dei parametri di campo:** valori tipizzati resi con formattazione italiana (`20,5 °C`, `7,9 U pH`, `05/08/2026`); i campi non trovati vengono mostrati come *«Non rilevato»* anziché nascosti — in un atto ambientale, un dato mancante è esso stesso un'informazione.
- **Consenso esplicito** per l'analisi AI, disattivato di default.

---

## Avvio in locale

**Prerequisiti:** Node.js 20+, .NET 10 SDK, Azure Functions Core Tools (`func`).

### 1. Backend

~~~bash
cd src/Ancorhash.Api
dotnet restore
~~~

Creare `local.settings.json` (escluso da git — non va mai committato):

~~~json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "Logging__LogLevel__Default": "Information",
    "AI__Endpoint": "https://<tua-risorsa>.cognitiveservices.azure.com/",
    "Evm__RelayerPrivateKey": "0xLA_TUA_CHIAVE_PRIVATA",
    "Turnstile__SecretKey": "1x0000000000000000000000000000000AA",
    "Blockchain__Networks__80002__RpcUrl": "https://rpc-amoy.polygon.technology",
    "Blockchain__Networks__80002__Name": "Polygon Amoy",
    "Blockchain__Networks__80002__NativeCoinId": "matic-network",
    "Blockchain__Networks__80002__IsTestnet": "true"
  },
  "Host": {
    "CORS": "http://localhost:5173",
    "CORSCredentials": false
  }
}
~~~

Azure AI usa la Managed Identity: autenticarsi con `az login` e verificare che l'utenza abbia il ruolo **Cognitive Services User** sulla risorsa Document Intelligence.

~~~bash
func start
~~~

> Se l'host segnala `Unable to load Function 'Extract'. A function with the id ... already exists`, sta rilevando due volte l'output di build. Va azzerato prima di riavviare — e conviene lasciare che sia `func start` a compilare:
> ~~~bash
> rm -rf src/Ancorhash.Api/bin src/Ancorhash.Api/obj && func start
> ~~~

### 2. Frontend

~~~bash
cd src/Ancorhash.Web
npm install
~~~

Creare il file `.env`:

~~~env
VITE_TURNSTILE_SITEKEY="1x00000000000000000000AA"
~~~

~~~bash
npm run dev   # http://localhost:5173
~~~

Caricare un verbale di campionamento, spuntare **«Consenti l'invio del documento al cloud per l'estrazione dei dati»**, e i parametri estratti compaiono accanto all'impronta crittografica.

> La prima chiamata a `/extract` dopo un avvio a freddo impiega circa 30 secondi (JIT più cold start di Azure); le successive si assestano sui 10 secondi. Conviene scaldare l'applicazione prima di una demo dal vivo.

---

## API

| Endpoint | Metodo | Scopo |
|---|---|---|
| `/api/v1/chains` | `GET` | Reti EVM configurate, con stima del costo in USD in tempo reale |
| `/api/v1/extract` | `POST` | `multipart/form-data` → testo OCR, coppie chiave-valore, `field_data` tipizzato |
| `/api/v1/notarize` | `POST` | Ancora sulla rete scelta un hash SHA-256 calcolato dal client |

Esempio di `field_data` da un verbale compilato:

~~~json
{
  "corso_acqua": "Torrente Polcevera",
  "data_prelievo": "2026-08-05",
  "temperatura_acqua_c": 20.5,
  "ph": 7.9,
  "ossigeno_disciolto_mg_l": 8.5,
  "has_any_value": true
}
~~~

---

<p align="center">
  <b>Ancorhash</b> — Atti ambientali dimostrabili, dati su cui agire.
</p>
