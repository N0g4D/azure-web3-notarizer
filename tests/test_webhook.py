"""Test suite per POST /api/v1/documents/webhook.

Copertura: auth boundaries, validation, SSRF guard, OOM guard, happy path.
Ogni chiamata di rete (Azure, Ethereum, download PDF) è mockata.
"""

import hashlib
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import VALID_API_KEY, VALID_PAYLOAD

WEBHOOK_URL = "/api/v1/documents/webhook"

# ── Dati finti restituiti dai mock ───────────────────────────────────
_FAKE_PDF = b"%PDF-1.4 fake content for testing"
_FAKE_EXTRACTED = {"Invoice Number": "INV-001", "_raw_content": "Sample text"}
_FAKE_TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"


def _auth() -> dict[str, str]:
    return {"X-API-Key": VALID_API_KEY}


# =====================================================================
# 401 Unauthorized — API Key mancante o errata
# =====================================================================
class TestAuth401:

    @pytest.mark.asyncio
    async def test_missing_api_key(self, client: AsyncClient) -> None:
        resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_api_key(self, client: AsyncClient) -> None:
        resp = await client.post(
            WEBHOOK_URL,
            json=VALID_PAYLOAD,
            headers={"X-API-Key": "chiave-totalmente-sbagliata"},
        )
        assert resp.status_code == 401


# =====================================================================
# 422 Unprocessable Entity — Validazione Pydantic / EIP-55
# =====================================================================
class TestValidation422:

    @pytest.mark.asyncio
    async def test_wallet_all_lowercase(self, client: AsyncClient) -> None:
        """wallet_address tutto minuscolo — checksum EIP-55 non valido."""
        payload = {
            **VALID_PAYLOAD,
            "wallet_address": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        }
        resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth())
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_wallet_too_short(self, client: AsyncClient) -> None:
        """wallet_address troppo corto."""
        payload = {**VALID_PAYLOAD, "wallet_address": "0xABCD"}
        resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth())
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_wallet_missing_0x_prefix(self, client: AsyncClient) -> None:
        """wallet_address senza prefisso 0x."""
        payload = {
            **VALID_PAYLOAD,
            "wallet_address": "d8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        }
        resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth())
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_document_url(self, client: AsyncClient) -> None:
        """document_url non è un URL valido."""
        payload = {**VALID_PAYLOAD, "document_url": "not-a-url"}
        resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth())
        assert resp.status_code == 422


# =====================================================================
# SSRF Guard — Rifiuto URL verso IP privati/loopback
# =====================================================================
class TestSSRFGuard:

    @pytest.mark.asyncio
    @patch("app.services.azure_client._is_private_ip_sync", return_value=True)
    async def test_loopback_blocked(
        self, mock_ip_check, client: AsyncClient
    ) -> None:
        """URL che punta a 127.0.0.1 viene bloccato dalla SSRF guard."""
        payload = {
            **VALID_PAYLOAD,
            "document_url": "https://127.0.0.1/test.pdf",
        }
        resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth())
        assert resp.status_code == 400
        assert "privat" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    @patch("app.services.azure_client._is_private_ip_sync", return_value=True)
    async def test_private_network_blocked(
        self, mock_ip_check, client: AsyncClient
    ) -> None:
        """URL che punta a 192.168.x.x viene bloccato."""
        payload = {
            **VALID_PAYLOAD,
            "document_url": "https://192.168.1.1/test.pdf",
        }
        resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth())
        assert resp.status_code == 400
        assert "privat" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_http_scheme_blocked(self, client: AsyncClient) -> None:
        """URL con schema HTTP (non HTTPS) viene bloccato."""
        payload = {
            **VALID_PAYLOAD,
            "document_url": "http://example.com/test.pdf",
        }
        resp = await client.post(WEBHOOK_URL, json=payload, headers=_auth())
        assert resp.status_code == 400
        assert "https" in resp.json()["detail"].lower()


# =====================================================================
# OOM Guard — PDF che supera il limite 10 MB durante lo streaming
# =====================================================================
class TestOOMGuard:

    @pytest.mark.asyncio
    @patch(
        "app.api.v1.endpoints.azure_client.download_pdf",
        new_callable=AsyncMock,
    )
    async def test_oversized_pdf_rejected(
        self, mock_download: AsyncMock, client: AsyncClient
    ) -> None:
        """download_pdf solleva ValueError quando il PDF supera 10 MB."""
        mock_download.side_effect = ValueError(
            "PDF troppo grande: >10485760 bytes (stream interrotto)"
        )
        resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth())
        assert resp.status_code == 400
        assert "troppo grande" in resp.json()["detail"].lower()


# =====================================================================
# 200 OK — Happy path completo (mock Azure + Web3)
# =====================================================================
class TestHappyPath:

    @pytest.mark.asyncio
    @patch(
        "app.api.v1.endpoints.web3_client.notarize_hash",
        new_callable=AsyncMock,
    )
    @patch(
        "app.api.v1.endpoints.azure_client.extract_document_data",
        new_callable=AsyncMock,
    )
    @patch(
        "app.api.v1.endpoints.azure_client.download_pdf",
        new_callable=AsyncMock,
    )
    async def test_full_pipeline_success(
        self,
        mock_download: AsyncMock,
        mock_extract: AsyncMock,
        mock_notarize: AsyncMock,
        client: AsyncClient,
    ) -> None:
        mock_download.return_value = _FAKE_PDF
        mock_extract.return_value = _FAKE_EXTRACTED
        mock_notarize.return_value = _FAKE_TX_HASH

        resp = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth())

        assert resp.status_code == 200
        body = resp.json()

        # Campi presenti nella response
        assert body["status"] == "success"
        assert body["document_id"] == VALID_PAYLOAD["document_id"]
        assert body["tx_hash"] == _FAKE_TX_HASH
        assert body["extracted_data"] == _FAKE_EXTRACTED

        # L'hash è calcolato sul file raw, non sull'output Azure
        expected_hash = hashlib.sha256(_FAKE_PDF).hexdigest()
        assert body["doc_hash"] == expected_hash

        # Verifica che i mock siano stati chiamati correttamente
        mock_download.assert_awaited_once()
        mock_extract.assert_awaited_once_with(_FAKE_PDF)
        mock_notarize.assert_awaited_once_with(
            VALID_PAYLOAD["wallet_address"], expected_hash
        )

    @pytest.mark.asyncio
    @patch(
        "app.api.v1.endpoints.web3_client.notarize_hash",
        new_callable=AsyncMock,
    )
    @patch(
        "app.api.v1.endpoints.azure_client.extract_document_data",
        new_callable=AsyncMock,
    )
    @patch(
        "app.api.v1.endpoints.azure_client.download_pdf",
        new_callable=AsyncMock,
    )
    async def test_hash_determinism(
        self,
        mock_download: AsyncMock,
        mock_extract: AsyncMock,
        mock_notarize: AsyncMock,
        client: AsyncClient,
    ) -> None:
        """Stesso PDF → stesso hash, indipendentemente dai dati Azure."""
        mock_download.return_value = _FAKE_PDF
        mock_notarize.return_value = _FAKE_TX_HASH

        # Prima chiamata: Azure restituisce un set di campi
        mock_extract.return_value = {"campo": "valore_A"}
        resp1 = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth())

        # Seconda chiamata: Azure restituisce campi DIVERSI (stesso PDF)
        mock_extract.return_value = {"campo": "valore_B", "extra": "dato"}
        resp2 = await client.post(WEBHOOK_URL, json=VALID_PAYLOAD, headers=_auth())

        # L'hash deve essere identico — dipende solo dal file raw
        assert resp1.json()["doc_hash"] == resp2.json()["doc_hash"]
        assert resp1.json()["doc_hash"] == hashlib.sha256(_FAKE_PDF).hexdigest()
