# 🏛️ Architettura di Sistema e Direttive per Agente AI

**Progetto:** API Webhook (FastAPI) per Estrazione e Notarizzazione Documentale B2B
**Ruolo Agente:** Senior Cloud & Web3 Solutions Architect + Python Backend Engineer
**Contesto di Business:** L'applicazione riceve certificati aziendali (es. ISO 9001, audit report, certificati stile RINA) inviati da un flusso Microsoft Power Automate. L'interfaccia utente (Frontend) è un'applicazione gestionale sviluppata in **Microsoft Power Apps**, usata dalle aziende per gestire i propri asset certificati. Il webhook estrae i dati chiave dal PDF tramite Azure AI per verifica, e ne registra un'impronta crittografica (Hash) su **Blockchain Ethereum** per garantirne la data certa e l'immutabilità.
**Integrazioni:** Power App (UI Gestionale) -> Power Automate (Ingress) -> Azure AI Document Intelligence (Estrazione OCR) -> Ethereum Sepolia/Mainnet (Egress Notarizzazione)

---

## 1. Stack Tecnologico Obbligatorio (VINCOLI DI SISTEMA)
- **Runtime:** Python 3.12+
- **Core Framework:** FastAPI + Uvicorn
- **Validazione:** Pydantic v2 + Pydantic-Settings (per la gestione rigorosa e tipizzata del `.env`)
- **AI & OCR:** `azure-ai-documentintelligence` (Evitare SDK deprecati, usare le API REST v3.1+ o gli SDK Python moderni)
- **Blockchain:** `web3.py` (Connessione via RPC Provider es. Infura/Alchemy)
- **Resilienza di Rete:** `tenacity` (retry esponenziale) + `httpx` (client asincrono per download PDF e chiamate API)
- **DIVIETO ASSOLUTO (Stateless Rule):** NON aggiungere database (SQL/NoSQL), NON aggiungere Redis, NON aggiungere Celery o RabbitMQ, NON creare interfacce frontend (il frontend è la Power App). L'API deve essere 100% stateless (nessun dato salvato su disco o memoria tra una richiesta e l'altra).

---

## 2. Sicurezza e Autenticazione (Ingress)
Il webhook sarà esposto su internet e chiamato esclusivamente da Power Automate.
1. **API Key Header:** Implementare la dipendenza `fastapi.security.APIKeyHeader`.
2. **Validazione:** Ogni richiesta in ingresso DEVE contenere l'header personalizzato `X-API-Key`.
3. **Verifica Sicura:** Il valore dell'header deve essere confrontato in tempo costante (usando `secrets.compare_digest`) con il segreto statico caricato in `BaseSettings` per prevenire attacchi di timing.

---

## 3. Architettura del Flusso Dati (Pipeline)

### Fase A: Ingress & Sanitization
1. Il webhook `POST /api/v1/documents/webhook` riceve il JSON payload da Power Automate.
2. Lo schema Pydantic valida il JSON in modalità `strict`. Campi richiesti:
   - `document_id` (UUID o stringa univoca passata dalla Power App).
   - `document_url` (URL temporaneo sicuro per scaricare il certificato PDF da SharePoint/OneDrive).
   - `wallet_address` (Indirizzo destinatario/emittente).
3. Il `wallet_address` DEVE passare un `@field_validator` per la validazione Checksum di Ethereum (EIP-55).

### Fase B: Estrazione e Analisi (Azure AI)
1. L'app scarica il PDF in memoria (RAM) tramite `document_url` via `httpx` (Timeout max: 10 secondi, limitazione dimensione buffer: 10MB).
2. Invio del buffer ad Azure AI Document Intelligence. Usare il modello `prebuilt-layout` con feature add-on `KEY_VALUE_PAIRS` (API v4.0 2024-11-30). Il precedente `prebuilt-document` è deprecato.
3. Implementare `tenacity` per retry automatici e backoff sulle chiamate ad Azure (gestione vitale per errori HTTP 429 Too Many Requests e 503).

### Fase C: Hashing e Notarizzazione On-Chain (Ethereum)
1. **Creazione Impronta:** Ordinamento deterministico delle chiavi del dizionario estratto da Azure (alfabetico) e conversione in stringa JSON. Generazione Hash SHA-256 della stringa.
2. **Preparazione Transazione EVM:**
   - **Network:** L'app deve poter puntare a Ethereum Sepolia (per la vetrina/test) o Ethereum Mainnet, in base all'`RPC_URL` configurato.
   - **To:** Il `wallet_address` validato.
   - **Value:** 0 ETH.
   - **Data Payload:** L'hash SHA-256 convertito in Hex.
   - **Gas:** Usare standard EIP-1559 (`maxFeePerGas`, `maxPriorityFeePerGas`) stimando le fee dinamicamente tramite `web3.py`. MAI hardcodare i Gwei.
   - **Nonce Management:** Essendo stateless, recuperare il nonce in tempo reale (`w3.eth.get_transaction_count(indirizzo, 'pending')`). Per evitare errori `NonceTooLow` in caso di webhook concorrenti, implementare retry tramite `tenacity`.
3. **Firma e Invio:** Firma locale con la `PRIVATE_KEY` del server (da `.env`) e Broadcast.
4. **Egress:** Ritorno immediato della Transaction Hash (`tx_hash`) a Power Automate affinché la Power App possa aggiornare l'interfaccia utente gestionale.

---

## 4. Osservabilità e Logging (JSON Format)
1. Configurare la libreria standard `logging` di Python affinché emetta log esclusivamente in **formato JSON strutturato** (es. tramite `python-json-logger`).
2. Ogni riga di log DEVE includere: `timestamp` (ISO 8601), `level` (INFO, WARNING, ERROR), e `document_id` (per correlare i log alla specifica richiesta della Power App).
3. Eventi critici da tracciare (`INFO` level):
   - "PDF successfully downloaded"
   - "Azure AI extraction completed"
   - "Ethereum transaction broadcasted" (Includere il `tx_hash` come campo nel JSON del log).

---

## 5. Mappatura degli Errori HTTP (Graceful Degradation)
L'API non deve mai andare in crash silente. Ogni fallimento solleva una `HTTPException` restituendo un JSON strutturato, indispensabile per il debug su Power Automate.

| HTTP Status | Causa dell'Errore | Comportamento Richiesto |
| :--- | :--- | :--- |
| **400 Bad Request** | PDF invalido, troppo grande (>10MB), o fallimento validazione EIP-55 del wallet. | Rifiutare la richiesta. Restituire il dettaglio esatto del campo errato. |
| **401 Unauthorized** | Header `X-API-Key` mancante o invalido. | Bloccare l'esecuzione immediatamente. |
| **422 Unprocessable Entity**| Il JSON da Power Automate non rispetta lo schema Pydantic. | Restituire i validation error automatici di FastAPI. |
| **429 Too Many Requests** | Quota superata su Azure AI o sul nodo RPC Ethereum (Infura/Alchemy). | Loggare l'evento in JSON. |
| **502 Bad Gateway** | Azure AI, nodo RPC Ethereum o link del PDF temporaneamente irraggiungibili. | Segnalare il blocco della dipendenza esterna. |
| **500 Internal Error** | Errore critico inaspettato (es. fallimento firma transazione). | Mascherare lo stack trace nel JSON di risposta, ma loggarlo interamente in console. |

---

## 6. Direttive Ferree per la Scrittura del Codice (Rules of Engagement)

> **ATTENZIONE:** La violazione di queste regole comporterà il fallimento della build.

1. **Gestione Segreti (Zero-Trust):** MAI scrivere chiavi private, API Key, endpoint Azure o RPC URL in chiaro. Tutto deve passare per `app/core/config.py` usando `BaseSettings`.
2. **No Smart Contract Deployment:** L'obiettivo è il Data Anchoring (Notarizzazione). Non dobbiamo scrivere codice Solidity né fare il deploy di un ERC-721. Stiamo sfruttando la blockchain come registro immutabile tramite transazioni standard (0 ETH).
3. **Testing Isolato (TDD mindset):** Non creare dipendenze circolari. Quando scrivi un modulo in `app/services/`, scrivi immediatamente il test `tests/test_<modulo>.py` mockando le chiamate di rete (`pytest-asyncio`, `unittest.mock`). Non fare MAI chiamate reali ad Azure/Ethereum durante i test.

---

## 7. Struttura Cartelle Richiesta
```text
.
├── docs/
│   └── ARCHITECTURE.md       # Questo file
├── app/
│   ├── api/
│   │   ├── dependencies.py   # Gestione API Key Header auth
│   │   └── v1/
│   │       └── endpoints.py  # Router FastAPI webhook
│   ├── core/
│   │   ├── config.py         # Pydantic BaseSettings (.env logic)
│   │   └── logger.py         # Setup logging JSON
│   ├── models/
│   │   └── schemas.py        # Pydantic BaseModel validazione I/O
│   ├── services/
│   │   ├── azure_client.py   # Logica OCR (httpx + tenacity)
│   │   └── web3_client.py    # Logica Blockchain Ethereum
│   └── main.py               # Inizializzazione FastAPI e Middlewares
├── tests/
├── .env.example              # Template variabili d'ambiente (VUOTI)
└── requirements.txt
```

---

## 8. Roadmap & Microsoft ISV Vision

### Core Identity

Ancorhash è un'applicazione **Web3 di notarizzazione**. Il prodotto è la certificazione dell'hash SHA-256 (calcolato sul file raw, byte-per-byte) sulla blockchain Ethereum. L'hash on-chain garantisce:

- **Prova di esistenza** — il documento esisteva al timestamp del blocco.
- **Integrità** — qualsiasi modifica al file produce un hash diverso.
- **Non-repudiabilità** — la firma crittografica del wallet notarizer lega l'operazione a un'identità.

Tutto il resto — Azure, Power Apps, Dataverse — è infrastruttura di delivery e go-to-market, non valore tecnico intrinseco.

### Ruolo di Azure (Estrattore di Comodità)

Azure AI Document Intelligence **non è il core del prodotto**. È stato scelto perché l'ecosistema Microsoft offre integrazione nativa tra i suoi servizi (Power Automate → Azure AI → Power Apps → Dataverse). Se domani Azure venisse sostituito con un altro OCR, il motore di notarizzazione non cambierebbe di una riga.

### Architettura Target (ISV)

```text
┌─────────────────────────────────────────────────────────┐
│                    POWER APP (UI)                        │
│  Gestionale aziendale per certificati B2B                │
│  Upload PDF → visualizza metadati → mostra tx_hash      │
└──────────────────────┬──────────────────────────────────┘
                       │  Dataverse (storage)
                       │  PDF + metadati + doc_hash + tx_hash
                       │
┌──────────────────────▼──────────────────────────────────┐
│               POWER AUTOMATE (orchestrator)              │
│  Trigger: nuovo record in Dataverse                      │
│  Azione: POST /api/v1/documents/webhook                  │
│  Callback: salva tx_hash + extracted_data nel record     │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│          ANCORHASH BACKEND (questo repo)                 │
│  FastAPI webhook — motore invisibile                     │
│                                                          │
│  PDF bytes ──→ SHA-256 ──→ Ethereum tx (0 ETH + hash)   │
│       │                                                  │
│       └──→ Azure AI ──→ extracted_data (JSON)            │
│            (comodità, non core)                           │
└──────────────────────┬──────────────────────────────────┘
                       │
              Ethereum Sepolia / Mainnet
              Transazione immutabile con hash nel campo data
```

### Fasi della Roadmap

| Fase | Stato | Descrizione |
| :--- | :--- | :--- |
| **1. Backend** | ✅ Completato | Webhook FastAPI E2E: download → Azure AI → SHA-256 su file raw → notarizzazione EIP-1559 su Sepolia. Security audit (SecretStr, SSRF guard, streaming OOM guard). Test suite 12/12. |
| **2. Power App** | 🔜 Prossimo | Gestionale su Power Apps + Dataverse. L'utente carica il PDF, la Power App lo salva in Dataverse, Power Automate chiama il webhook, il record viene arricchito con `tx_hash`, `doc_hash`, `extracted_data`. |
| **3. ISV Submission** | 📋 Pianificato | Presentazione della soluzione completa (Power App + Dataverse + backend Web3) al programma Microsoft ISV (Independent Software Vendor). Il Web3 è il motore antifrode invisibile; il prodotto commerciale per Microsoft è il gestionale su Power Apps/Dataverse. |

### Principio Architetturale

> Il backend Python è un **motore sotto il cofano**. Non ha UI, non ha stato, non ha database. Riceve una richiesta, notarizza, risponde. La Power App è il prodotto che l'utente vede e che Microsoft valuta.