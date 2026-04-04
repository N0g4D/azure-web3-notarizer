"""Router webhook — orchestrazione della pipeline di notarizzazione.

Flusso: Ingress (Pydantic) → Download PDF → Azure AI → SHA-256 → Ethereum → Egress.
Ogni fallimento è mappato su un codice HTTP preciso per il debug in Power Automate.
"""

import traceback

from azure.core.exceptions import HttpResponseError
from fastapi import APIRouter, Depends, HTTPException, status
from web3.exceptions import Web3RPCError

from app.api.dependencies import verify_api_key
from app.core.logger import logger
from app.models.schemas import WebhookPayload
from app.services import azure_client, web3_client

router = APIRouter(prefix="/api/v1/documents", tags=["webhook"])


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def webhook(
    payload: WebhookPayload,
    _api_key: str = Depends(verify_api_key),
) -> dict:
    """Endpoint principale chiamato da Power Automate.

    Riceve un certificato, lo analizza via Azure AI, ne genera l'hash
    SHA-256 e lo notarizza su Ethereum. Restituisce il ``tx_hash``
    alla Power App.
    """
    doc_id = payload.document_id
    log_extra = {"document_id": doc_id}

    logger.info("Elaborazione documento avviata", extra=log_extra)

    # ── Fase A: Download PDF ─────────────────────────────────────────
    try:
        pdf_bytes = await azure_client.download_pdf(str(payload.document_url))
    except ValueError as exc:
        # PDF troppo grande (>10 MB)
        logger.warning("PDF rifiutato: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except ConnectionError as exc:
        # Timeout o errore di rete sul download
        logger.error("Download PDF fallito: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Impossibile scaricare il PDF dal link fornito.",
        ) from exc

    # ── Fase B: Estrazione Azure AI ──────────────────────────────────
    try:
        extracted_data = await azure_client.extract_document_data(pdf_bytes)
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
        # Nessun dato estratto dal documento
        logger.warning("Estrazione vuota: %s", exc, extra=log_extra)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    # ── Fase C: Hashing deterministico ───────────────────────────────
    doc_hash = web3_client.generate_hash(extracted_data)
    logger.info(
        "Hash SHA-256 generato",
        extra={**log_extra, "doc_hash": doc_hash},
    )

    # ── Fase D: Notarizzazione Ethereum ──────────────────────────────
    try:
        tx_hash = await web3_client.notarize_hash(
            payload.wallet_address, doc_hash
        )
    except (Web3RPCError, ConnectionError) as exc:
        logger.error(
            "Notarizzazione Ethereum fallita: %s\n%s",
            exc,
            traceback.format_exc(),
            extra=log_extra,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Errore durante la notarizzazione on-chain.",
        ) from exc

    # ── Egress ───────────────────────────────────────────────────────
    logger.info(
        "Ethereum transaction broadcasted",
        extra={**log_extra, "tx_hash": tx_hash},
    )

    return {
        "status": "success",
        "document_id": doc_id,
        "tx_hash": tx_hash,
    }
