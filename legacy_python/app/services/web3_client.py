"""Client asincrono per hashing deterministico e notarizzazione on-chain (Ethereum).

Nessuna dipendenza da FastAPI: solleva eccezioni Python standard.
"""

import asyncio
import hashlib
from functools import lru_cache

from eth_account import Account
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from web3 import AsyncWeb3
from web3.exceptions import Web3RPCError
from app.core.config import settings
from app.core.logger import logger

# --- Singleton: riutilizza provider HTTP e account tra le richieste ---

_w3: AsyncWeb3 | None = None
_chain_id: int | None = None


def _get_w3() -> AsyncWeb3:
    """Restituisce un'istanza AsyncWeb3 singleton (riusa il pool HTTP)."""
    global _w3
    if _w3 is None:
        _w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(settings.RPC_URL))
    return _w3


@lru_cache(maxsize=1)
def _get_account() -> Account:
    """Carica l'account dal PRIVATE_KEY (cached, parsato una sola volta)."""
    return Account.from_key(settings.PRIVATE_KEY.get_secret_value())


async def _get_chain_id() -> int:
    """Restituisce il chain_id (cached dopo la prima chiamata RPC)."""
    global _chain_id
    if _chain_id is None:
        _chain_id = await _get_w3().eth.chain_id
    return _chain_id


def generate_hash(file_bytes: bytes) -> str:
    """SHA-256 del file raw (byte-per-byte).

    L'hash è calcolato direttamente sul contenuto binario del documento,
    garantendo determinismo assoluto: stesso file → stesso hash, sempre,
    indipendentemente da Azure o qualsiasi altro intermediario.

    Returns:
        Hash SHA-256 in formato hex (64 caratteri, senza prefisso 0x).
    """
    return hashlib.sha256(file_bytes).hexdigest()


@retry(
    retry=retry_if_exception_type(Web3RPCError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def notarize_hash(wallet_address: str, doc_hash: str) -> str:
    """Costruisce, firma e invia una transazione EIP-1559 a 0 ETH con l'hash nel campo data.

    Args:
        wallet_address: Indirizzo Ethereum destinatario (EIP-55 validato).
        doc_hash: Hash SHA-256 hex (64 caratteri, senza 0x).

    Returns:
        Transaction hash in formato hex (con prefisso 0x).

    Raises:
        Web3RPCError: Se il broadcast fallisce dopo 3 tentativi (es. NonceTooLow).
        ConnectionError: Se il nodo RPC non è raggiungibile.
    """
    w3 = _get_w3()
    account = _get_account()

    try:
        chain_id, nonce, latest_block, max_priority_fee = await asyncio.gather(
            _get_chain_id(),
            w3.eth.get_transaction_count(account.address, "pending"),
            w3.eth.get_block("latest"),
            w3.eth.max_priority_fee,
        )
        base_fee = latest_block.get("baseFeePerGas", 0)
    except Exception as exc:
        msg = f"Impossibile comunicare con il nodo RPC: {exc}"
        raise ConnectionError(msg) from exc

    max_fee_per_gas = (base_fee * 2) + max_priority_fee
    data_hex = "0x" + doc_hash

    tx = {
        "type": 2,  # EIP-1559
        "chainId": chain_id,
        "from": account.address,
        "to": wallet_address,
        "value": 0,
        "data": data_hex,
        "nonce": nonce,
        "maxFeePerGas": max_fee_per_gas,
        "maxPriorityFeePerGas": max_priority_fee,
    }

    try:
        gas_estimate = await w3.eth.estimate_gas(tx)
    except Exception as exc:
        msg = f"Stima gas fallita: {exc}"
        raise ConnectionError(msg) from exc

    tx["gas"] = gas_estimate

    signed = account.sign_transaction(tx)
    tx_hash = await w3.eth.send_raw_transaction(signed.raw_transaction)
    tx_hash_hex = tx_hash.hex()

    logger.info(
        "Ethereum transaction broadcasted",
        extra={"tx_hash": tx_hash_hex, "wallet_address": wallet_address},
    )
    return f"0x{tx_hash_hex}"
