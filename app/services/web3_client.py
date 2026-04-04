"""Client asincrono per hashing deterministico e notarizzazione on-chain (Ethereum).

Nessuna dipendenza da FastAPI: solleva eccezioni Python standard.
"""

import hashlib
import json

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


def _build_w3() -> AsyncWeb3:
    """Crea un'istanza AsyncWeb3 connessa all'RPC configurato."""
    return AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(settings.RPC_URL))


def _get_account() -> Account:
    """Carica l'account dal PRIVATE_KEY in settings."""
    return Account.from_key(settings.PRIVATE_KEY)


def generate_hash(data: dict) -> str:
    """Ordinamento deterministico + SHA-256.

    1. Ordina le chiavi alfabeticamente (ricorsivo non necessario: i valori
       Azure sono stringhe piatte).
    2. Serializza in JSON compatto (no spazi).
    3. Restituisce l'hash SHA-256 in formato hex (senza prefisso 0x).
    """
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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
    w3 = _build_w3()
    account = _get_account()

    try:
        chain_id = await w3.eth.chain_id
        nonce = await w3.eth.get_transaction_count(account.address, "pending")
        latest_block = await w3.eth.get_block("latest")
        base_fee = latest_block.get("baseFeePerGas", 0)
        max_priority_fee = await w3.eth.max_priority_fee
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
