# Ancorhash

**Enterprise Web3 Document Notarization platform. Zero Data Leakage, Gas-Sponsored, Fiat-Ready.**

[![.NET 10](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Ethereum](https://img.shields.io/badge/Ethereum-3C3C3D?logo=ethereum&logoColor=white)](https://ethereum.org)

---

## What is Ancorhash?

Ancorhash is a B2B SaaS platform designed to bring cryptographic proof of existence and data integrity to the Enterprise world (Banks, Healthcare, Public Administration) without the compliance and UX hurdles typical of Web3 applications.

Ancorhash allows users to timestamp and notarize documents on EVM-compatible blockchains (Ethereum, Polygon) providing mathematical certainty that a document existed at a specific time and has not been altered since. 

### The Enterprise Differentiators
1. **Zero Data Leakage:** Due to GDPR and corporate compliance, sensitive documents (contracts, medical records) cannot be uploaded to third-party cloud services. Ancorhash computes the SHA-256 cryptographic hash of the file **locally inside the user's browser**. Only the 32-byte hash is sent to the backend. The document never leaves the user's device.
2. **Gas-Sponsored Relayer:** Corporate clients cannot manage crypto wallets, private keys, or hold volatile cryptocurrencies on their balance sheets. Ancorhash uses a Relayer architecture: the backend signs and pays for the blockchain transaction (Gas) on behalf of the user.
3. **Fiat Billing (Stripe-Ready):** Users pay a predictable, standard fiat fee (e.g., in USD/EUR) via credit card for the service. The backend orchestrates a real-time decentralized pricing oracle to calculate the gas cost and applies a fixed service markup.

---

## Why Arkiv?

*Why a notarization registry needs a Web3 database, and not Postgres.*

**A notary that you have to trust is not a notary.** Ancorhash's product is a
claim a third party can check: *this document existed, in this form, at this
time.* The proof is only as strong as the weakest thing the verifier must take
on faith — and in a conventional stack, that weakest thing is us.

Put the registry in Postgres and the operator can delete a row, change a
timestamp, or insert one dated last year. Nothing in the database resists it,
and nothing in it records that it happened. A customer in a dispute cannot
tell the difference between a real record and one we wrote this morning, so
they are not relying on cryptography — they are relying on Ancorhash's good
behaviour and continued existence. That is precisely the dependency the
product claims to remove.

**Arkiv makes the index itself evidence.** Every entity is a signed
transaction on a public chain. The record's `$creator` is immutable and
unforgeable, so a verifier can confirm a record was written by the Ancorhash
relayer and not fabricated afterwards — and can do it without our cooperation,
our API, or our permission. We cannot quietly rewrite history, because we do
not own the history.

**Expiry that the data enforces, not a policy nobody can audit.** Under GDPR,
data minimisation means not keeping records longer than necessary. In a normal
database that is a retention policy: a cron job, a config value, a promise. A
regulator cannot verify a promise, and a backup silently outlives it. Arkiv
entities carry their own expiry: the record stops being returned by queries
when its time is up, with no delete call and no job to trust. Retention of
**the public index** stops being something we assert and becomes something the
data does.

#### What expiry does and does not do

That claim is narrow on purpose, and it is worth stating the limit plainly
rather than letting someone find it.

Expiry removes the entity from the public, queryable index. That is all it
does. Specifically, it does **not**:

- **delete the document.** The encrypted blob stays on Swarm for as long as its
  postage batch is paid. Expiry touches Arkiv, not storage.
- **revoke the decryption key.** Anyone already holding the 128-hex reference
  can still fetch and decrypt the file afterwards. The reference is a bearer
  credential; nothing on chain can claw it back.
- **undo reads that already happened.** The index was public while it lived.
  Anything copied out of it stays copied, and the anchor transaction on
  Avalanche is immutable by design.

So expiry is **data minimisation of the public index, not access control.**
What it buys is real but bounded: the set of notarizations a third party can
discover and correlate shrinks on a schedule the data carries itself, without
anyone having to trust that we ran the cleanup job. What it does not buy is
revocation.

Revocation would need a different mechanism — Swarm's ACT grantee lists, or
re-encrypting under a key the holder never had. That is out of scope here, and
we would rather say so than let the expiry story imply a guarantee it cannot
make.

**The privacy split is what makes a public index safe.** The document is
encrypted in the browser and stored on Swarm; the decryption key never leaves
the client. What reaches Arkiv is only commitments — a SHA-256 hash, a 64-hex
Swarm address, an organisation slug, a timestamp. Public enough to verify,
empty enough to publish. Arkiv's own brief is blunt that this is the required
posture: *"It is not a confidentiality layer… store a hash or a commitment
instead."* The queryable index and the confidential payload are different
systems, on purpose.

### The honest part

Two limits we would rather state than have a judge find.

**`org` is declared, not proven.** Entities are signed by our relayer wallet,
which is what lets corporate users notarize without ever touching a wallet or
holding crypto. The signature proves *Ancorhash wrote this record*. It does
**not** prove the named organisation authorised it. Making `org` provable
requires the organisation to hold its own key, or an attestation from a
trusted issuer — real work, and not 40 hours of it.

**And a normal database would be fine for most of this.** Postgres would serve
the dashboard faster, cheaper, with richer queries, full-text search, joins and
no block times. If Ancorhash were an internal document tracker, Postgres would
be the right answer and Arkiv would be overhead. The Web3 database earns its
place on exactly one axis: **an adversarial verifier who does not trust the
operator.** Take that reader away and the argument collapses. Keep them — and
for a notarization service they are the only reader who matters — and a
private database cannot do the job at any price.

> The mechanical design (attributes, types, expiry arithmetic, queries) is in
> [`arkiv/schema.md`](arkiv/schema.md).

---

## System Architecture

The V2 architecture separates the local hashing and intelligence layer from the Web3 transactional layer, ensuring complete data privacy.

~~~mermaid
graph LR
    USER["User"] -->|"Drags PDF"| BROWSER["<b>React Frontend</b><br/><i>Local Hashing</i>"]
    
    BROWSER -->|"1. Check Costs"| API["<b>.NET 10 Backend</b><br/><i>Relayer Engine</i>"]
    BROWSER -->|"2. Fiat Checkout"| STRIPE["<b>Stripe</b><br/><i>Billing Mock</i>"]
    BROWSER -->|"3. POST /notarize"| API

    API -->|"Fetch USD Price"| ORACLE["<b>CoinGecko</b><br/><i>Oracle</i>"]
    API -->|"Simulate & Broadcast"| ETH["<b>Blockchain</b><br/><i>EVM Node</i>"]

    style BROWSER fill:#20232a,stroke:#61dafb,color:#fff
    style API fill:#512bd4,stroke:#512bd4,color:#fff
    style ETH fill:#3C3C3D,stroke:#627EEA,color:#fff
    style STRIPE fill:#635bff,stroke:#635bff,color:#fff
~~~

### The Notarization Flow (Sequence)

~~~mermaid
sequenceDiagram
    participant B as React Frontend
    participant A as .NET Backend API
    participant O as CoinGecko Oracle
    participant R as EVM Blockchain Node
    
    B->>B: Computes SHA-256 locally (Zero Data Leakage)
    B->>A: GET /api/v1/chains (Request pricing)
    A->>O: Fetch MATIC/ETH USD price
    A->>R: Estimate Gas Limit & Price
    A-->>B: Returns supported chains & dynamic USD costs
    B->>B: Displays Checkout Mock (Gas Cost + Service Fee)
    B->>A: POST /api/v1/notarize (Hash, Turnstile Token, ChainId)
    A->>A: Validate Anti-bot & IP Rate Limit
    A->>R: Broadcast EIP-1559 Transaction (Data = Hash)
    R-->>A: Transaction Hash
    A-->>B: Success Response + Etherscan Link
~~~

---

## Technology Stack

### Backend (`src/Ancorhash.Api` / `Core` / `Infrastructure`)
Built with **C# .NET 10 (Isolated Azure Functions)** for maximum scalability and serverless execution.
- **Blockchain:** `Nethereum` for RPC interactions and EIP-1559 transaction building.
- **Security:** `Cloudflare Turnstile` server-side validation and custom IP-based `RateLimitingMiddleware` using `IMemoryCache` to prevent wallet draining.
- **Pricing Oracle:** Real-time fiat conversion via `CoinGecko` API, heavily cached and designed to fail-soft (fallback to $0) in case of rate limits.
- **Observability:** `OpenTelemetry` configured for Enterprise-grade logging.

### Frontend (`src/Ancorhash.Web`)
Built with **React, TypeScript, Vite, and Tailwind CSS**.
- **Local Hashing:** Fast, memory-safe client-side SHA-256 generation using `crypto.subtle`.
- **UI/UX:** Minimalist, monochromatic design optimized for B2B dashboards. Includes a Mock Checkout interface for live product demonstrations.
- **Anti-bot:** `@marsidev/react-turnstile` integrated seamlessly into the submission flow.

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- .NET 10 SDK
- Azure Functions Core Tools (`func`)

### 1. Backend Setup
Navigate to the API project and restore dependencies:
~~~bash
cd src/Ancorhash.Api
dotnet restore
~~~
Create a `local.settings.json` file. Ensure you configure a valid Relayer Private Key (with funds on the selected networks) and standard RPC URLs:
~~~json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "Logging__LogLevel__Default": "Information",
    "Evm__RelayerPrivateKey": "0xYOUR_PRIVATE_KEY",
    "Turnstile__SecretKey": "1x0000000000000000000000000000000AA",
    "Blockchain__Networks__11155111__RpcUrl": "https://sepolia.infura.io/v3/...",
    "Blockchain__Networks__11155111__Name": "Ethereum Sepolia",
    "Blockchain__Networks__11155111__NativeCoinId": "ethereum",
    "Blockchain__Networks__11155111__IsTestnet": "true"
  },
  "Host": {
    "CORS": "http://localhost:5173",
    "CORSCredentials": false
  }
}
~~~
Run the backend:
~~~bash
dotnet run
~~~

### 2. Frontend Setup
In a new terminal, navigate to the Web project:
~~~bash
cd src/Ancorhash.Web
npm install
~~~
Create a `.env` file for the Turnstile public test key:
~~~env
VITE_TURNSTILE_SITEKEY="1x00000000000000000000AA"
~~~
Start the Vite development server:
~~~bash
npm run dev
~~~
Open `http://localhost:5173` in your browser.

---

## Security & Protections

Since Ancorhash pays the transaction fees, the `/api/v1/notarize` endpoint is a highly critical surface. It is protected by a multi-layered defense strategy:
1. **IP Rate Limiting:** Discards requests aggressively at the middleware layer if an IP exceeds the allowed threshold (HTTP 429), saving CPU and API calls.
2. **Cloudflare Turnstile:** Blocks headless browsers and automated scripts via cryptographic challenges (HTTP 403).
3. **Fail-Safe Orchestration:** Any failure in the RPC nodes or pricing oracles is caught, logged via OpenTelemetry, and handled gracefully without crashing the host process.

---

## Historical Note: The V1 PoC
Ancorhash originally started as a Python and FastAPI project (`azure-web3-notarizer`). That initial proof-of-concept acted as a pure API-first middleware. However, it relied on downloading the actual PDF payload to the server for processing. To meet stringent Enterprise data privacy requirements, the architecture was entirely reimagined and rewritten in .NET and React (V2) to achieve true Zero Data Leakage.

---
<p align="center">
  <b>Ancorhash</b> — Trust through Cryptography.
</p>