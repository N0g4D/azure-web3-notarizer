"""Router API-first — endpoint atomici e workflow composito.

Tre rotte:
- POST /api/v1/notarize                       → download + SHA-256 + Ethereum
- POST /api/v1/extract                        → download + Azure OCR
- POST /api/v1/workflows/process-and-notarize → flusso completo (Azure ∥ Web3)

Tutte protette da X-API-Key. La logica di download e la mappatura degli
errori vivono in helper privati per non duplicare codice.
"""

import asyncio

from azure.core.exceptions import HttpResponseError
from fastapi import APIRouter, Depends, HTTPException, status
from web3.exceptions import Web3RPCError

from app.api.dependencies import verify_api_key
from app.core.logger import logger
from app.models.schemas import (
    ExtractRequest,
    ExtractResponse,
    FullProcessRequest,
    FullProcessResponse,
    NotarizeRequest,
    NotarizeResponse,
)
from app.services import azure_client, web3_client

router = APIRouter(prefix="/api/v1", tags=["api-v1"])


# ─────────────────────────── helper privati ──────────────────────────────


async def _download(document_url: str, log_extra: dict) -> bytes:
    """Scarica il PDF con tutte le guardie (SSRF, OOM, timeout)."""
    try:
        return await azure_client.download_pdf(document_url)
    except ValueError as exc:
        logger.warning("PDF rifiutato: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except ConnectionError as exc:
        logger.error("Download PDF fallito: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Impossibile scaricare il PDF dal link fornito.",
        ) from exc


async def _extract(pdf_bytes: bytes, log_extra: dict) -> dict:
    """Estrae dati via Azure mappando gli errori su HTTPException."""
    try:
        return await azure_client.extract_document_data(pdf_bytes)
    except HttpResponseError as exc:
        if exc.status_code in {429, 503}:
            logger.warning(
                "Azure AI quota/rate limit superato dopo retry: %s",
                exc,
                extra=log_extra,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Quota Azure AI superata. Riprovare più tardi.",
            ) from exc
        logger.error("Azure AI errore HTTP: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Azure AI Document Intelligence non raggiungibile.",
        ) from exc
    except ConnectionError as exc:
        logger.error("Azure AI non raggiungibile: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Azure AI Document Intelligence non raggiungibile.",
        ) from exc
    except ValueError as exc:
        logger.warning("Estrazione vuota: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


async def _notarize(wallet_address: str, doc_hash: str, log_extra: dict) -> str:
    """Notarizza l'hash on-chain mappando gli errori su HTTPException."""
    try:
        return await web3_client.notarize_hash(wallet_address, doc_hash)
    except (Web3RPCError, ConnectionError) as exc:
        logger.error(
            "Notarizzazione Ethereum fallita: %s",
            exc.__class__.__name__,
            extra=log_extra,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Errore durante la notarizzazione on-chain.",
        ) from exc


# ───────────────────────────── endpoints ─────────────────────────────────


@router.post(
    "/notarize",
    status_code=status.HTTP_200_OK,
    response_model=NotarizeResponse,
)
async def notarize(
    payload: NotarizeRequest,
    _api_key: str = Depends(verify_api_key),
) -> NotarizeResponse:
    """Scarica il PDF, ne calcola SHA-256 e notarizza on-chain."""
    log_extra = {"document_id": payload.document_id}
    logger.info("Notarize: avvio", extra=log_extra)

    pdf_bytes = await _download(str(payload.document_url), log_extra)
    doc_hash = web3_client.generate_hash(pdf_bytes)
    logger.info(
        "Hash SHA-256 generato",
        extra={**log_extra, "doc_hash": doc_hash},
    )
    tx_hash = await _notarize(payload.wallet_address, doc_hash, log_extra)

    logger.info(
        "Ethereum transaction broadcasted",
        extra={**log_extra, "tx_hash": tx_hash},
    )
    return NotarizeResponse(
        document_id=payload.document_id,
        doc_hash=doc_hash,
        tx_hash=tx_hash,
    )


@router.post(
    "/extract",
    status_code=status.HTTP_200_OK,
    response_model=ExtractResponse,
)
async def extract(
    payload: ExtractRequest,
    _api_key: str = Depends(verify_api_key),
) -> ExtractResponse:
    """Scarica il PDF e ne estrae i dati strutturati via Azure AI."""
    log_extra = {"document_id": payload.document_id}
    logger.info("Extract: avvio", extra=log_extra)

    pdf_bytes = await _download(str(payload.document_url), log_extra)
    extracted_data = await _extract(pdf_bytes, log_extra)

    logger.info("Extract: completato", extra=log_extra)
    return ExtractResponse(
        document_id=payload.document_id,
        extracted_data=extracted_data,
    )


@router.post(
    "/workflows/process-and-notarize",
    status_code=status.HTTP_200_OK,
    response_model=FullProcessResponse,
)
async def process_and_notarize(
    payload: FullProcessRequest,
    _api_key: str = Depends(verify_api_key),
) -> FullProcessResponse:
    """Flusso completo: download → (Azure ∥ Web3) → risposta unificata."""
    log_extra = {"document_id": payload.document_id}
    logger.info("Workflow: avvio", extra=log_extra)

    pdf_bytes = await _download(str(payload.document_url), log_extra)
    doc_hash = web3_client.generate_hash(pdf_bytes)
    logger.info(
        "Hash SHA-256 generato",
        extra={**log_extra, "doc_hash": doc_hash},
    )

    # Azure OCR ∥ Ethereum notarization in parallelo.
    extracted_data, tx_hash = await asyncio.gather(
        _extract(pdf_bytes, log_extra),
        _notarize(payload.wallet_address, doc_hash, log_extra),
    )

    logger.info(
        "Workflow completato",
        extra={**log_extra, "tx_hash": tx_hash},
    )
    return FullProcessResponse(
        document_id=payload.document_id,
        doc_hash=doc_hash,
        tx_hash=tx_hash,
        extracted_data=extracted_data,
    )
