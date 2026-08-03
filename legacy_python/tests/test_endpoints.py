"""Test suite per gli endpoint API-first.

Rotte coperte:
- POST /api/v1/workflows/process-and-notarize  (auth, validation, SSRF, OOM, happy)
- POST /api/v1/notarize                        (happy + isolation: no Azure)
- POST /api/v1/extract                         (happy + isolation: no Web3)

Tutte le chiamate di rete (Azure, Ethereum, download PDF) sono mockate.
"""

import hashlib
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import VALID_API_KEY, VALID_PAYLOAD

WORKFLOW_URL = "/api/v1/workflows/process-and-notarize"
NOTARIZE_URL = "/api/v1/notarize"
EXTRACT_URL = "/api/v1/extract"

# ── Dati finti restituiti dai mock ───────────────────────────────────
_FAKE_PDF = b"%PDF-1.4 fake content for testing"
_FAKE_EXTRACTED = {"Invoice Number": "INV-001", "_raw_content": "Sample text"}
_FAKE_TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"

_NOTARIZE_PAYLOAD = {
    "document_id": VALID_PAYLOAD["document_id"],
    "document_url": VALID_PAYLOAD["document_url"],
    "wallet_address": VALID_PAYLOAD["wallet_address"],
}
_EXTRACT_PAYLOAD = {
    "document_id": VALID_PAYLOAD["document_id"],
    "document_url": VALID_PAYLOAD["document_url"],
}


def _auth() -> dict[str, str]:
    return {"X-API-Key": VALID_API_KEY}


# =====================================================================
# 401 Unauthorized
# =====================================================================
class TestAuth401:

    @pytest.mark.asyncio
    async def test_missing_api_key(self, client: AsyncClient) -> None:
        resp = await client.post(WORKFLOW_URL, json=VALID_PAYLOAD)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_api_key(self, client: AsyncClient) -> None:
        resp = await client.post(
            WORKFLOW_URL,
            json=VALID_PAYLOAD,
            headers={"X-API-Key": "chiave-totalmente-sbagliata"},
        )
        assert resp.status_code == 401


# =====================================================================
# 422 Validation / EIP-55
# =====================================================================
class TestValidation422:

    @pytest.mark.asyncio
    async def test_wallet_all_lowercase(self, client: AsyncClient) -> None:
        payload = {
            **VALID_PAYLOAD,
            "wallet_address": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        }
        resp = await client.post(WORKFLOW_URL, json=payload, headers=_auth())
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_wallet_too_short(self, client: AsyncClient) -> None:
        payload = {**VALID_PAYLOAD, "wallet_address": "0xABCD"}
        resp = await client.post(WORKFLOW_URL, json=payload, headers=_auth())
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_wallet_missing_0x_prefix(self, client: AsyncClient) -> None:
        payload = {
            **VALID_PAYLOAD,
            "wallet_address": "d8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        }
        resp = await client.post(WORKFLOW_URL, json=payload, headers=_auth())
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_document_url(self, client: AsyncClient) -> None:
        payload = {**VALID_PAYLOAD, "document_url": "not-a-url"}
        resp = await client.post(WORKFLOW_URL, json=payload, headers=_auth())
        assert resp.status_code == 422


# =====================================================================
# SSRF Guard
# =====================================================================
class TestSSRFGuard:

    @pytest.mark.asyncio
    @patch("app.services.azure_client._is_private_ip_sync", return_value=True)
    async def test_loopback_blocked(
        self, mock_ip_check, client: AsyncClient
    ) -> None:
        payload = {
            **VALID_PAYLOAD,
            "document_url": "https://127.0.0.1/test.pdf",
        }
        resp = await client.post(WORKFLOW_URL, json=payload, headers=_auth())
        assert resp.status_code == 400
        assert "privat" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    @patch("app.services.azure_client._is_private_ip_sync", return_value=True)
    async def test_private_network_blocked(
        self, mock_ip_check, client: AsyncClient
    ) -> None:
        payload = {
            **VALID_PAYLOAD,
            "document_url": "https://192.168.1.1/test.pdf",
        }
        resp = await client.post(WORKFLOW_URL, json=payload, headers=_auth())
        assert resp.status_code == 400
        assert "privat" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_http_scheme_blocked(self, client: AsyncClient) -> None:
        payload = {
            **VALID_PAYLOAD,
            "document_url": "http://example.com/test.pdf",
        }
        resp = await client.post(WORKFLOW_URL, json=payload, headers=_auth())
        assert resp.status_code == 400
        assert "https" in resp.json()["detail"].lower()


# =====================================================================
# OOM Guard
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
        mock_download.side_effect = ValueError(
            "PDF troppo grande: >10485760 bytes (stream interrotto)"
        )
        resp = await client.post(WORKFLOW_URL, json=VALID_PAYLOAD, headers=_auth())
        assert resp.status_code == 400
        assert "troppo grande" in resp.json()["detail"].lower()


# =====================================================================
# Workflow happy path (Azure ∥ Web3)
# =====================================================================
class TestWorkflowHappyPath:

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

        resp = await client.post(WORKFLOW_URL, json=VALID_PAYLOAD, headers=_auth())

        assert resp.status_code == 200
        body = resp.json()

        assert body["status"] == "success"
        assert body["document_id"] == VALID_PAYLOAD["document_id"]
        assert body["tx_hash"] == _FAKE_TX_HASH
        assert body["extracted_data"] == _FAKE_EXTRACTED

        expected_hash = hashlib.sha256(_FAKE_PDF).hexdigest()
        assert body["doc_hash"] == expected_hash

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
        mock_download.return_value = _FAKE_PDF
        mock_notarize.return_value = _FAKE_TX_HASH

        mock_extract.return_value = {"campo": "valore_A"}
        resp1 = await client.post(WORKFLOW_URL, json=VALID_PAYLOAD, headers=_auth())

        mock_extract.return_value = {"campo": "valore_B", "extra": "dato"}
        resp2 = await client.post(WORKFLOW_URL, json=VALID_PAYLOAD, headers=_auth())

        assert resp1.json()["doc_hash"] == resp2.json()["doc_hash"]
        assert resp1.json()["doc_hash"] == hashlib.sha256(_FAKE_PDF).hexdigest()


# =====================================================================
# /notarize — NON deve toccare Azure
# =====================================================================
class TestNotarizeEndpoint:

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
    async def test_notarize_happy_path_no_azure(
        self,
        mock_download: AsyncMock,
        mock_extract: AsyncMock,
        mock_notarize: AsyncMock,
        client: AsyncClient,
    ) -> None:
        mock_download.return_value = _FAKE_PDF
        mock_notarize.return_value = _FAKE_TX_HASH

        resp = await client.post(
            NOTARIZE_URL, json=_NOTARIZE_PAYLOAD, headers=_auth()
        )

        assert resp.status_code == 200
        body = resp.json()
        expected_hash = hashlib.sha256(_FAKE_PDF).hexdigest()

        assert body["status"] == "success"
        assert body["document_id"] == _NOTARIZE_PAYLOAD["document_id"]
        assert body["doc_hash"] == expected_hash
        assert body["tx_hash"] == _FAKE_TX_HASH
        assert "extracted_data" not in body

        mock_download.assert_awaited_once()
        mock_notarize.assert_awaited_once_with(
            _NOTARIZE_PAYLOAD["wallet_address"], expected_hash
        )
        # Garanzia di isolamento: Azure NON deve essere chiamato.
        mock_extract.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_notarize_requires_wallet(self, client: AsyncClient) -> None:
        payload = {
            k: v for k, v in _NOTARIZE_PAYLOAD.items() if k != "wallet_address"
        }
        resp = await client.post(NOTARIZE_URL, json=payload, headers=_auth())
        assert resp.status_code == 422


# =====================================================================
# /extract — NON deve toccare Web3
# =====================================================================
class TestExtractEndpoint:

    @pytest.mark.asyncio
    @patch(
        "app.api.v1.endpoints.web3_client.notarize_hash",
        new_callable=AsyncMock,
    )
    @patch(
        "app.api.v1.endpoints.web3_client.generate_hash",
    )
    @patch(
        "app.api.v1.endpoints.azure_client.extract_document_data",
        new_callable=AsyncMock,
    )
    @patch(
        "app.api.v1.endpoints.azure_client.download_pdf",
        new_callable=AsyncMock,
    )
    async def test_extract_happy_path_no_web3(
        self,
        mock_download: AsyncMock,
        mock_extract: AsyncMock,
        mock_generate_hash,
        mock_notarize: AsyncMock,
        client: AsyncClient,
    ) -> None:
        mock_download.return_value = _FAKE_PDF
        mock_extract.return_value = _FAKE_EXTRACTED

        resp = await client.post(
            EXTRACT_URL, json=_EXTRACT_PAYLOAD, headers=_auth()
        )

        assert resp.status_code == 200
        body = resp.json()

        assert body["status"] == "success"
        assert body["document_id"] == _EXTRACT_PAYLOAD["document_id"]
        assert body["extracted_data"] == _FAKE_EXTRACTED
        assert "tx_hash" not in body
        assert "doc_hash" not in body

        mock_download.assert_awaited_once()
        mock_extract.assert_awaited_once_with(_FAKE_PDF)
        # Garanzia di isolamento: Web3 NON deve essere chiamato.
        mock_notarize.assert_not_awaited()
        mock_generate_hash.assert_not_called()
