# Sanitization & Hardening Checklist

Promemoria estendibile — controlli da integrare per pulizia e sicurezza.
Ogni item è marcato con priorità e stato.

---

## 1. Validazione Settings (`app/core/config.py`)

- [x] **PRIVATE_KEY** — formato `0x` + 64 hex chars (già implementato)
- [ ] **RPC_URL** — validare che sia un URL HTTPS valido (`HttpUrl` di Pydantic). Bloccare URL HTTP in produzione.
- [ ] **API_KEY** — lunghezza minima (>= 32 chars), charset hex o alfanumerico. Evitare che un valore banale passi silenziosamente.
- [ ] **AZURE_ENDPOINT** — validare come `HttpUrl`, deve terminare con trailing slash o essere normalizzato.
- [ ] **AZURE_KEY** — lunghezza minima (Azure keys sono tipicamente 32+ chars).
- [ ] **APP_ENV / ENVIRONMENT** — aggiungere variabile `ENV` con default `production`. Usarla per abilitare/disabilitare debug, log verbosi, CORS permissivi.

## 2. Sicurezza API / Headers

- [ ] **Rate limiting** — aggiungere `slowapi` o middleware custom per limitare req/min per IP (webhook esposto pubblicamente).
- [ ] **CORS** — se non serve, disabilitare completamente (`allow_origins=[]`). Attualmente non configurato = default FastAPI (no CORS headers).
- [ ] **Content-Type enforcement** — rifiutare richieste non `application/json` prima di Pydantic.
- [ ] **Request body size limit** — impostare un max body size a livello middleware per evitare payload bomba (es. 1 MB max per il JSON del webhook).
- [ ] **Security headers** — aggiungere `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` via middleware.

## 3. Input Validation (`app/models/schemas.py`)

- [ ] **document_id** — aggiungere `max_length` (es. 256) e regex pattern per caratteri ammessi (alfanumerico + trattini). Prevenire injection via ID arbitrari.
- [ ] **document_url** — restringere scheme a `https://` only (no `http://`, `ftp://`, `file://`). Prevenire SSRF.
- [ ] **wallet_address** — già validato EIP-55. OK.

## 4. Download PDF (`app/services/azure_client.py`)

- [ ] **SSRF protection** — validare che `document_url` non punti a IP privati/loopback (`127.0.0.1`, `10.x`, `172.16-31.x`, `169.254.x`, `::1`). Bloccare redirect a IP interni.
- [ ] **Content-Type check** — verificare che il Content-Type della response sia `application/pdf` prima di processare.
- [ ] **Follow redirects** — limitare il numero di redirect (httpx default è 20, ridurre a 3-5).
- [ ] **TLS verification** — assicurarsi che `verify=True` sia attivo (default httpx, ma esplicitarlo).

## 5. Web3 / Blockchain (`app/services/web3_client.py`)

- [ ] **doc_hash validation** — verificare che sia esattamente 64 hex chars prima di costruire la transazione. Attualmente si fida del chiamante.
- [ ] **Gas cap** — impostare un max gas price / max gas limit per evitare transazioni accidentalmente costose.
- [ ] **Nonce management** — attualmente usa `"pending"`. Considerare un mutex se si prevedono richieste concorrenti per evitare nonce collision.
- [ ] **Transaction receipt** — opzionale: attendere conferma con `wait_for_transaction_receipt` con timeout, per avere certezza dell'inclusione on-chain.

## 6. Logging & Observability

- [ ] **Sensitive data scrubbing** — assicurarsi che `PRIVATE_KEY`, `AZURE_KEY`, `API_KEY` non vengano mai loggati, nemmeno in caso di eccezione. Verificare che i traceback non espongano settings.
- [ ] **Correlation ID** — propagare `document_id` in tutti i log dell'intera pipeline (alcune chiamate attualmente non lo includono).
- [ ] **Structured error responses** — standardizzare i body di errore (es. `{"error": "...", "document_id": "..."}`) per tutti gli status code.

## 7. Dependency Pinning

- [ ] **requirements.txt** — pinnare versioni esatte (`package==x.y.z`) per build riproducibili. Attualmente unpinned.
- [ ] **azure-ai-documentintelligence** — pinnare a `>=1.0.0` minimo (SDK pre-GA aveva API diversa con `analyze_request`).

## 8. Secrets Management

- [ ] **`.env` in `.gitignore`** — verificare che `.env` sia in gitignore (contiene chiave privata Ethereum!).
- [ ] **Secret rotation plan** — documentare procedura per ruotare API_KEY, PRIVATE_KEY, AZURE_KEY senza downtime.

---

> Questo file è un promemoria vivo. Aggiungi item man mano che emergono nuovi requisiti.
