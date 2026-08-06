# Ancorhash — Environmental Compliance & Web3 Notarizer

**Tamper-proof environmental reporting. Local hashing, blockchain anchoring, AI-extracted field parameters.**

[![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Azure AI](https://img.shields.io/badge/Azure%20AI-0078D4?logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/en-us/products/ai-services/ai-document-intelligence)
[![Polygon](https://img.shields.io/badge/Polygon-7B3FE4?logo=polygon&logoColor=white)](https://polygon.technology/)

> **Vertical branch.** This branch (`feature/azure-ai-water-sampling`) is the environmental-compliance vertical, built around the *Verbale di campionamento acque superficiali* (surface water sampling report). The generic Enterprise platform lives on [`main`](../../tree/main).

---

## The Problem

Environmental monitoring runs on paper. A surface water sampling report is filled in by hand at the riverbank, scanned, emailed, and filed — and that chain has two structural weaknesses:

**1. The document can be altered after the fact.**
A sampling report is a legal record: it certifies what a specific stretch of river looked like at a specific hour. Between the field and the archive there is no cryptographic guarantee that a pH value was not corrected, a date shifted, or a page replaced. When a report becomes evidence in a dispute over a landfill's discharge, its integrity is exactly what gets challenged — and there is no way to prove it.

**2. The data stays trapped on paper.**
The measured parameters — water temperature, pH, dissolved oxygen — are written into boxes on a form, one digit per box. To reach the management system that should be watching them, a human has to retype them. That means delay (days between sampling and data entry), cost, and transcription errors on precisely the values that would reveal a problem. An oxygen reading of 2,1 mg/l is an environmental alarm; sitting in a PDF in a shared folder, it is nothing at all.

---

## The Solution

Two independent capabilities, deliberately decoupled: one guarantees the document, the other unlocks its content.

### 1. Zero-Data-Leakage Web3 anchoring

The SHA-256 hash of the report is computed **inside the browser** using the native Web Crypto API. Only that 32-byte fingerprint is sent to the backend, which anchors it in the `data` field of an EIP-1559 transaction on Polygon (or any configured EVM network).

The document itself never leaves the operator's device. This matters beyond privacy hygiene: sampling reports carry the name of the sampler, the operator, and the site — personal and commercially sensitive data that a public body cannot casually push to a third-party cloud. Anchoring the hash produces a public, timestamped, immutable proof of existence, while the file stays where it belongs.

Verification is symmetric and needs no trust in us: re-hash the file, compare it with the on-chain value. If a single byte changed, the hashes diverge.

The organisation never touches a wallet, a private key, or a token: the backend acts as a **gas-sponsored relayer**, signing and paying for the transaction. A notarization on Polygon mainnet currently costs about **$0.0008** of gas — measured live through an on-chain gas estimate combined with a CoinGecko price oracle.

### 2. AI Document Intelligence — turning paper into actionable data

When the operator explicitly opts in, the document is sent to **Azure AI Document Intelligence**, and a domain parser extracts the field parameters as typed values:

| Field | Type | Reference range printed on the form |
|---|---|---|
| Corso d'acqua (watercourse) | `string` | — |
| Data di prelievo (sampling date) | `date` | — |
| Temperatura acqua (water temperature) | `decimal` °C | limit 21,5 °C (salmonids) / 28,0 °C (cyprinids) |
| pH | `decimal` | normal 7,8 – 8,8 |
| Ossigeno disciolto (dissolved oxygen) | `decimal` mg/l | normal 9,0 – 12,0 |

Because the output is **strongly typed** — a `decimal` of 4.2, not the string `"|0| |4|, |2|"` — the receiving management system can compare it against a threshold the moment the report is uploaded. That is what makes an environmental alarm possible: pH 4,2 on an acidified watercourse, or dissolved oxygen at 2,1 mg/l against a 9,0 minimum, becomes a machine-readable signal within seconds of sampling instead of a line noticed weeks later during manual data entry.

> **Scope, stated plainly.** This branch delivers the extraction and the typed contract. Threshold evaluation and alerting are intentionally left to the receiving system (Power Platform / Dataverse), which is where escalation rules and recipients already live. The API hands over clean data ready for that step — it does not implement the alarm itself.

**The consent trade-off is explicit in the UI.** Anchoring is always zero-leakage; extraction is not, because OCR requires the file. So the analysis is strictly opt-in, off by default, with a checkbox stating that the document will be sent to the cloud. Decline it and the flow still works — you get the hash and the blockchain proof, and the card reports *"Analisi AI disabilitata per tutelare la privacy. Il documento non ha mai lasciato questo dispositivo."*

---

## Parsing a real form is harder than it looks

The official ARPAL template is not a clean digital form, and the parser is built against the OCR output of a genuinely compiled document rather than an idealised one:

- **One box per digit.** The form prints `|_| |_|, |_|`, and OCR returns `|2| |0|, |5|` — sometimes with stray spaces inside the boxes. A normalisation pass recomposes these runs into `20,5` before any rule is applied.
- **Unicode unit glyphs.** Azure returns `℃` (U+2103, a single character), not `°C`.
- **Values that wrap.** `Corso d'acqua Torrente` ends a line and `Polcevera` starts the next; the value is read across the break, up to the next form label.
- **Italian decimal comma**, parsed with invariant culture after normalisation.
- **Near-miss traps, deliberately excluded:** `Temperatura aria` and `Temperatura sonda` sit next to `Temperatura acqua`; the `%` saturation figure sits next to the `mg/l` concentration; the footer carries a `rev00 del 10/11/2022` revision date; and three pages of filling instructions quote example values such as *"valori normali 7,8-8,8 U pH"*. Each rule is anchored so that none of these is ever mistaken for a measurement.
- **Blank forms stay blank.** Placeholder boxes contain no digits, so an uncompiled template yields `null` on every field and `has_any_value: false` — the absence of a value is reported as such, never invented.

Every extracted number is additionally range-checked (pH 0–14, temperature −5…60 °C, oxygen 0–30 mg/l): an implausible value is treated as an OCR artefact and discarded rather than surfaced.

---

## System Architecture

~~~mermaid
graph LR
    OP["Field Operator"] -->|"Uploads report"| BROWSER["<b>React Frontend</b><br/><i>Local SHA-256</i>"]

    BROWSER -.->|"Opt-in only"| API2["<b>.NET 10 Backend</b><br/><i>/api/v1/extract</i>"]
    API2 --> AZURE["<b>Azure AI</b><br/><i>Document Intelligence</i>"]
    API2 --> PARSER["<b>Domain Parser</b><br/><i>Field parameters</i>"]

    BROWSER -->|"Hash only"| API["<b>.NET 10 Backend</b><br/><i>/api/v1/notarize</i>"]
    API -->|"Gas-sponsored EIP-1559"| CHAIN["<b>Polygon / EVM</b><br/><i>Immutable proof</i>"]
    PARSER -.->|"Typed JSON"| ERP["<b>Management System</b><br/><i>Threshold & alerting</i>"]

    style BROWSER fill:#20232a,stroke:#61dafb,color:#fff
    style API fill:#512bd4,stroke:#512bd4,color:#fff
    style API2 fill:#512bd4,stroke:#512bd4,color:#fff
    style AZURE fill:#0078D4,stroke:#0078D4,color:#fff
    style CHAIN fill:#7B3FE4,stroke:#7B3FE4,color:#fff
    style ERP fill:#107C10,stroke:#107C10,color:#fff
~~~

### The Compliance Flow

~~~mermaid
sequenceDiagram
    participant B as React Frontend
    participant A as .NET Backend
    participant Z as Azure AI
    participant R as Polygon Node

    B->>B: SHA-256 computed locally (document never uploaded)
    opt Operator opts in to AI analysis
        B->>A: POST /api/v1/extract (multipart)
        A->>Z: Analyze (prebuilt-layout + key-value pairs)
        Z-->>A: OCR text + form field pairs
        A->>A: Domain parser -> typed field parameters
        A-->>B: field_data (watercourse, date, T, pH, O2)
    end
    B->>A: POST /api/v1/notarize (hash, chain_id, anti-bot token)
    A->>A: IP rate limit + Turnstile validation
    A->>R: Broadcast EIP-1559 transaction (data = hash)
    R-->>A: Transaction hash
    A-->>B: On-chain proof + block explorer link
~~~

---

## Technology Stack

### Backend — C# .NET 10, Isolated Azure Functions
Clean Architecture across `Ancorhash.Api` / `Ancorhash.Core` / `Ancorhash.Infrastructure`.
- **AI extraction:** `Azure.AI.DocumentIntelligence` (`prebuilt-layout` with the key-value-pairs feature). Authentication is **keyless** via `DefaultAzureCredential` / Managed Identity — no API keys in configuration by default.
- **Domain parsing:** `WaterSamplingReportParser` lives in `Core` with zero external dependencies — pure, testable business logic. It reads from two sources, the OCR text and Azure's key-value pairs, because on form documents the value often sits in a cell detached from its label.
- **Blockchain:** `Nethereum`, EIP-1559 transactions, multi-chain by configuration (a `Dictionary<int, NetworkConfig>` keyed by EIP-155 chain id), with a per-network `IWeb3` cache.
- **Secrets:** relayer private key resolved from **Azure Key Vault** through the configuration pipeline; nothing sensitive in source or in the repository.
- **Security:** Cloudflare Turnstile server-side validation (fail-closed) plus IP rate limiting on the notarization endpoint, protecting the gas-sponsoring wallet from draining.
- **Observability:** OpenTelemetry, structured logging throughout.

### Frontend — React, TypeScript, Vite, Tailwind CSS
- **Local hashing:** `crypto.subtle.digest` — no third-party crypto library.
- **Field parameters card:** typed values rendered with Italian formatting (`20,5 °C`, `7,9 U pH`, `05/08/2026`); fields that were not found are shown as *"Non rilevato"* rather than hidden — in an environmental record, a missing value is itself information.
- **Explicit consent** for AI analysis, off by default.

---

## Local Development Setup

**Prerequisites:** Node.js 20+, .NET 10 SDK, Azure Functions Core Tools (`func`).

### 1. Backend

~~~bash
cd src/Ancorhash.Api
dotnet restore
~~~

Create `local.settings.json` (git-ignored — never commit it):

~~~json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "Logging__LogLevel__Default": "Information",
    "AI__Endpoint": "https://<your-resource>.cognitiveservices.azure.com/",
    "Evm__RelayerPrivateKey": "0xYOUR_PRIVATE_KEY",
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

Azure AI uses Managed Identity: sign in with `az login` and make sure your account holds the **Cognitive Services User** role on the Document Intelligence resource.

~~~bash
func start
~~~

> If the host reports `Unable to load Function 'Extract'. A function with the id ... already exists`, stale build output is being picked up twice. Clear it and restart — and let `func start` do the build itself:
> ~~~bash
> rm -rf src/Ancorhash.Api/bin src/Ancorhash.Api/obj && func start
> ~~~

### 2. Frontend

~~~bash
cd src/Ancorhash.Web
npm install
~~~

Create `.env`:

~~~env
VITE_TURNSTILE_SITEKEY="1x00000000000000000000AA"
~~~

~~~bash
npm run dev   # http://localhost:5173
~~~

Upload a sampling report, tick **"Consenti l'invio del documento al cloud per l'estrazione dei dati"**, and the extracted parameters appear alongside the cryptographic fingerprint.

> The first `/extract` call after a cold start takes ~30 seconds (JIT plus Azure cold start); subsequent calls settle around 10 seconds. Warm the app up before a live demo.

---

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/chains` | `GET` | Configured EVM networks with live USD cost estimates |
| `/api/v1/extract` | `POST` | `multipart/form-data` → OCR text, key-value pairs, typed `field_data` |
| `/api/v1/notarize` | `POST` | Anchors a client-computed SHA-256 hash on the selected chain |

Example `field_data` from a compiled report:

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
  <b>Ancorhash</b> — Environmental records you can prove, and data you can act on.
</p>
