"""Fixture condivise per la test suite.

Bypassa le variabili d'ambiente obbligatorie con valori finti
e fornisce un TestClient pronto all'uso.
"""

import os

import pytest
import pytest_asyncio

# ── Env vars fasulle PRIMA di qualsiasi import dall'app ──────────────
# La chiave privata è un hex valido a 32 byte (64 caratteri) ma NON
# controlla fondi reali — serve solo perché eth_account possa
# istanziare un Account senza errori.
_FAKE_ENV = {
    "API_KEY": "test-api-key-super-secret",
    "RPC_URL": "https://rpc.fake.test",
    "PRIVATE_KEY": "0x" + "ab" * 32,
    "AZURE_ENDPOINT": "https://fake-azure.cognitiveservices.azure.com",
    "AZURE_KEY": "fake-azure-key-000",
}


@pytest.fixture(autouse=True)
def _set_fake_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inietta variabili d'ambiente finte per ogni test, così
    ``Settings()`` non fallisce al momento dell'import."""
    for key, value in _FAKE_ENV.items():
        monkeypatch.setenv(key, value)


# Impostiamo le env vars anche a livello di modulo così che l'import
# top-level di ``app.core.config.settings`` (singleton) non esploda
# al momento del collect di pytest.
for _k, _v in _FAKE_ENV.items():
    os.environ.setdefault(_k, _v)


from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.main import app  # noqa: E402

VALID_API_KEY = _FAKE_ENV["API_KEY"]

# Un wallet address con checksum EIP-55 valido (indirizzo noto di Vitalik).
VALID_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

VALID_PAYLOAD = {
    "document_id": "REQ-2026-0001",
    "document_url": "https://example.com/cert.pdf",
    "wallet_address": VALID_WALLET,
}


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Header di autenticazione valido."""
    return {"X-API-Key": VALID_API_KEY}


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    """httpx AsyncClient collegato all'app FastAPI via ASGI transport."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
