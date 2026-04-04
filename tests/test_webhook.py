"""Test suite per POST /api/v1/documents/webhook.

Copertura completa della Mappatura Errori HTTP (ARCHITECTURE.md §5).
Ogni chiamata di rete (Azure, Ethereum, download PDF) è mockata.
"""

from unittest.mock import AsyncMock, patch

import pytest
from azure.core.exceptions import HttpResponseError
from httpx import AsyncClient

from tests.conftest import VALID_API_KEY, VALID_PAYLOAD

WEBHOOK_URL = "/api/v1/documents/webhook"

# ── Dati finti restituiti dai mock ───────────────────────────────────
_FAKE_PDF = b"%PDF-1.4 fake content"
_FAKE_EXTRACTED = {"campo_a": "valore_1", "campo_b": "valore_2"}
_FAKE_TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"


def _auth_headers() -> dict[str, str]:
    return {"X-API-Key": VALID_API_KEY}


# =====================================================================
# 200 OK — Flusso di successo completo
# =====================================================================
@pytest.mark.asyncio
@patch("app.api.v1.endpoints.web3_client.notarize_hash", new_callable=AsyncMock)
@patch("app.api.v1.endpoints.azure_client.extract_document_data", new_callable=AsyncMock)
@patch("app.api.v1.endpoints.azure_client.download_pdf", new_callable=AsyncMock)
async def test_webhook_success(
    mock_download: AsyncMock,
    mock_extract: AsyncMock,
    mock_notarize: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_download.return_value = _FAKE_PDF
    mock_extract.return_value = _FAKE_EXTRACTED
    mock_notarize.return_value = _FAKE_TX_HASH

    resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    assert body["document_id"] == VALID_PAYLOAD["document_id"]
    assert body["tx_hash"] == _FAKE_TX_HASH

    mock_download.assert_awaited_once()
    mock_extract.assert_awaited_once_with(_FAKE_PDF)
    mock_notarize.assert_awaited_once()


# =====================================================================
# 401 Unauthorized — API Key mancante o errata
# =====================================================================
@pytest.mark.asyncio
async def test_webhook_401_missing_key(client: AsyncClient) -> None:
    """Nessun header X-API-Key."""
    resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_401_wrong_key(client: AsyncClient) -> None:
    """Header X-API-Key con valore errato."""
    resp = await client.post(
        WEBHOOK_URL,
        json=VALID_PAYLOAD,
        headers={"X-API-Key": "chiave-sbagliata"},
    )
    assert resp.status_code == 401


# =====================================================================
# 422 Unprocessable Entity — Validazione Pydantic
# =====================================================================
@pytest.mark.asyncio
async def test_webhook_422_missing_document_id(client: AsyncClient) -> None:
    """Payload senza document_id."""
    payload = {
        "document_url": "https://example.com/cert.pdf",
        "wallet_address": VALID_PAYLOAD["wallet_address"],
    }
    resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth_headers())
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_webhook_422_bad_wallet_checksum(client: AsyncClient) -> None:
    """wallet_address tutto minuscolo — checksum EIP-55 non valido."""
    payload = {
        **VALID_PAYLOAD,
        "wallet_address": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    }
    resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth_headers())
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_webhook_422_invalid_url(client: AsyncClient) -> None:
    """document_url non è un URL valido."""
    payload = {**VALID_PAYLOAD, "document_url": "not-a-url"}
    resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth_headers())
    assert resp.status_code == 422


# =====================================================================
# 400 Bad Request — PDF troppo grande (ValueError da download_pdf)
# =====================================================================
@pytest.mark.asyncio
@patch("app.api.v1.endpoints.azure_client.download_pdf", new_callable=AsyncMock)
async def test_webhook_400_pdf_too_large(
    mock_download: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_download.side_effect = ValueError("PDF troppo grande: 15000000 bytes")

    resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth_headers())

    assert resp.status_code == 400
    assert "troppo grande" in resp.json()["detail"].lower()


# =====================================================================
# 502 Bad Gateway — Download PDF fallito (ConnectionError)
# =====================================================================
@pytest.mark.asyncio
@patch("app.api.v1.endpoints.azure_client.download_pdf", new_callable=AsyncMock)
async def test_webhook_502_download_failure(
    mock_download: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_download.side_effect = ConnectionError("Timeout")

    resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth_headers())

    assert resp.status_code == 502


# =====================================================================
# 502 Bad Gateway — Azure AI non raggiungibile (ConnectionError)
# =====================================================================
@pytest.mark.asyncio
@patch("app.api.v1.endpoints.azure_client.extract_document_data", new_callable=AsyncMock)
@patch("app.api.v1.endpoints.azure_client.download_pdf", new_callable=AsyncMock)
async def test_webhook_502_azure_unreachable(
    mock_download: AsyncMock,
    mock_extract: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_download.return_value = _FAKE_PDF
    mock_extract.side_effect = ConnectionError("Azure non raggiungibile")

    resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth_headers())

    assert resp.status_code == 502


# =====================================================================
# 429 Too Many Requests — Azure quota esaurita (HttpResponseError 429)
# =====================================================================
@pytest.mark.asyncio
@patch("app.api.v1.endpoints.azure_client.extract_document_data", new_callable=AsyncMock)
@patch("app.api.v1.endpoints.azure_client.download_pdf", new_callable=AsyncMock)
async def test_webhook_429_azure_rate_limit(
    mock_download: AsyncMock,
    mock_extract: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_download.return_value = _FAKE_PDF

    error_429 = HttpResponseError(message="Too Many Requests")
    error_429.status_code = 429
    mock_extract.side_effect = error_429

    resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth_headers())

    assert resp.status_code == 429


# =====================================================================
# 500 Internal Server Error — Notarizzazione Ethereum fallita
# =====================================================================
@pytest.mark.asyncio
@patch("app.api.v1.endpoints.web3_client.notarize_hash", new_callable=AsyncMock)
@patch("app.api.v1.endpoints.azure_client.extract_document_data", new_callable=AsyncMock)
@patch("app.api.v1.endpoints.azure_client.download_pdf", new_callable=AsyncMock)
async def test_webhook_500_notarization_failure(
    mock_download: AsyncMock,
    mock_extract: AsyncMock,
    mock_notarize: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_download.return_value = _FAKE_PDF
    mock_extract.return_value = _FAKE_EXTRACTED
    mock_notarize.side_effect = ConnectionError("Nodo RPC irraggiungibile")

    resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth_headers())

    assert resp.status_code == 500
    assert "notarizzazione" in resp.json()["detail"].lower()
