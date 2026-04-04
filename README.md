# AML Notarization Webhook

> **Microsoft ISV Success Program** — This project is developed as part of the Microsoft ISV Success initiative, leveraging Azure AI services for enterprise-grade document intelligence.

Stateless FastAPI webhook that receives business certificates (ISO 9001, audit reports, RINA-style documents) from **Microsoft Power Automate**, extracts key data via **Azure AI Document Intelligence**, and anchors a cryptographic fingerprint (SHA-256) on the **Ethereum blockchain** to guarantee immutability and timestamping.

## Architecture

```
Power App (UI) → Power Automate → [This Webhook] → Azure AI (OCR) → Ethereum (Notarization)
```

| Layer | Technology |
|:---|:---|
| **Runtime** | Python 3.12+, FastAPI, Uvicorn |
| **Validation** | Pydantic v2, Pydantic-Settings |
| **Document AI** | Azure AI Document Intelligence (REST v3.1+) |
| **Blockchain** | Web3.py — EIP-1559 transactions on Ethereum Sepolia / Mainnet |
| **Resilience** | Tenacity (exponential backoff), httpx (async HTTP) |

The API is **100% stateless**: no database, no cache, no queue. Each request is self-contained.

## Project Structure

```
app/
├── api/
│   ├── dependencies.py       # API Key authentication (X-API-Key header)
│   └── v1/
│       └── endpoints.py      # POST /api/v1/documents/webhook
├── core/
│   ├── config.py             # Pydantic BaseSettings (.env loader)
│   └── logger.py             # Structured JSON logging
├── models/
│   └── schemas.py            # WebhookPayload with EIP-55 validation
├── services/
│   ├── azure_client.py       # PDF download + Azure AI extraction
│   └── web3_client.py        # SHA-256 hashing + Ethereum notarization
└── main.py                   # FastAPI entrypoint
```

## Configuration

Copy the environment template and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|:---|:---|
| `API_KEY` | Secret key for webhook authentication (shared with Power Automate) |
| `RPC_URL` | Ethereum JSON-RPC endpoint (e.g. Infura, Alchemy) |
| `PRIVATE_KEY` | Server wallet private key for signing transactions |
| `AZURE_ENDPOINT` | Azure AI Document Intelligence endpoint URL |
| `AZURE_KEY` | Azure AI Document Intelligence API key |

> **Security:** Never commit `.env` to version control. All secrets are loaded at runtime via `pydantic-settings`.

## Installation

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

For development (includes test dependencies):

```bash
pip install -r requirements-dev.txt
```

## Running the Server

```bash
uvicorn app.main:app --reload
```

The webhook endpoint will be available at:

```
POST http://localhost:8000/api/v1/documents/webhook
```

A health check is exposed at:

```
GET http://localhost:8000/health
```

## Running Tests

```bash
pytest tests/ -v
```

All tests are fully isolated — no real network calls to Azure or Ethereum.

## License

Proprietary. All rights reserved.
