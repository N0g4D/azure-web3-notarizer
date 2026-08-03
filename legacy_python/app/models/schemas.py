"""Schemi Pydantic per gli endpoint API-first.

Tre richieste atomiche (notarize / extract / full process) e i relativi
response model. La validazione resta *strict*: nessun dato sporco
raggiunge Azure o Ethereum.
"""

from pydantic import BaseModel, Field, HttpUrl, field_validator
from web3 import Web3


def _validate_eip55(v: str) -> str:
    """Valida un indirizzo Ethereum con checksum EIP-55."""
    if not v.startswith("0x") or len(v) != 42:
        msg = "L'indirizzo deve essere di 42 caratteri e iniziare con 0x."
        raise ValueError(msg)
    try:
        checksummed = Web3.to_checksum_address(v)
    except ValueError as exc:
        msg = f"Indirizzo Ethereum non valido: {exc}"
        raise ValueError(msg) from exc
    if v != checksummed:
        msg = f"Checksum EIP-55 non corretto. Indirizzo atteso: {checksummed}"
        raise ValueError(msg)
    return v


# ─────────────────────────────── Requests ────────────────────────────────


class _BaseRequest(BaseModel):
    model_config = {"strict": True}

    document_id: str = Field(
        ...,
        min_length=1,
        description="Identificativo univoco del documento (dalla Power App).",
    )
    document_url: HttpUrl = Field(
        ...,
        description="URL temporaneo per scaricare il certificato PDF.",
    )


class NotarizeRequest(_BaseRequest):
    """Richiesta per la sola notarizzazione on-chain (no Azure)."""

    wallet_address: str = Field(
        ...,
        description="Indirizzo Ethereum del destinatario/emittente (EIP-55).",
    )

    @field_validator("wallet_address")
    @classmethod
    def _check_wallet(cls, v: str) -> str:
        return _validate_eip55(v)


class ExtractRequest(_BaseRequest):
    """Richiesta per la sola estrazione OCR via Azure (no Web3)."""


class FullProcessRequest(_BaseRequest):
    """Richiesta per il flusso completo: estrazione + notarizzazione."""

    wallet_address: str = Field(
        ...,
        description="Indirizzo Ethereum del destinatario/emittente (EIP-55).",
    )

    @field_validator("wallet_address")
    @classmethod
    def _check_wallet(cls, v: str) -> str:
        return _validate_eip55(v)


# ─────────────────────────────── Responses ───────────────────────────────


class NotarizeResponse(BaseModel):
    status: str = "success"
    document_id: str
    doc_hash: str
    tx_hash: str


class ExtractResponse(BaseModel):
    status: str = "success"
    document_id: str
    extracted_data: dict


class FullProcessResponse(BaseModel):
    status: str = "success"
    document_id: str
    doc_hash: str
    tx_hash: str
    extracted_data: dict
