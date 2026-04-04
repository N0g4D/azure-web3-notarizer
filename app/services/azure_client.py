"""Client asincrono per download PDF e estrazione dati via Azure AI Document Intelligence.

Nessuna dipendenza da FastAPI: solleva eccezioni Python standard.
"""

from typing import Any

import httpx
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.logger import logger

_MAX_PDF_BYTES = 10 * 1024 * 1024  # 10 MB
_DOWNLOAD_TIMEOUT = 10.0  # secondi


def _is_retryable_azure_error(exc: BaseException) -> bool:
    """Ritorna True per errori HTTP 429 (rate limit) e 503 (service unavailable)."""
    from azure.core.exceptions import HttpResponseError

    if isinstance(exc, HttpResponseError) and exc.status_code in {429, 503}:
        return True
    return False


async def download_pdf(document_url: str) -> bytes:
    """Scarica un PDF da *document_url* in memoria.

    Raises:
        ValueError: Se il Content-Length supera 10 MB o il body effettivo eccede il limite.
        ConnectionError: Se il download fallisce o va in timeout.
    """
    try:
        async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT) as client:
            response = await client.get(str(document_url))
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        msg = f"Download PDF fallito — HTTP {exc.response.status_code}"
        raise ConnectionError(msg) from exc
    except httpx.TimeoutException as exc:
        msg = f"Download PDF in timeout dopo {_DOWNLOAD_TIMEOUT}s"
        raise ConnectionError(msg) from exc
    except httpx.HTTPError as exc:
        msg = f"Errore di rete durante il download del PDF: {exc}"
        raise ConnectionError(msg) from exc

    content_length = response.headers.get("content-length")
    if content_length is not None and int(content_length) > _MAX_PDF_BYTES:
        msg = f"PDF troppo grande: {content_length} bytes (max {_MAX_PDF_BYTES})"
        raise ValueError(msg)

    pdf_bytes = response.content
    if len(pdf_bytes) > _MAX_PDF_BYTES:
        msg = f"PDF troppo grande: {len(pdf_bytes)} bytes (max {_MAX_PDF_BYTES})"
        raise ValueError(msg)

    logger.info("PDF successfully downloaded", extra={"size_bytes": len(pdf_bytes)})
    return pdf_bytes


@retry(
    retry=retry_if_exception(_is_retryable_azure_error),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def extract_document_data(pdf_bytes: bytes) -> dict[str, Any]:
    """Invia il buffer PDF ad Azure AI Document Intelligence ed estrae i campi.

    Usa il modello ``prebuilt-document``. Le chiamate vengono ritentate
    automaticamente in caso di errori 429 / 503 (max 3 tentativi, backoff
    esponenziale).

    Raises:
        ConnectionError: Se Azure non è raggiungibile dopo i retry.
        ValueError: Se l'estrazione non produce risultati utili.
    """
    credential = AzureKeyCredential(settings.AZURE_KEY)
    client = DocumentIntelligenceClient(
        endpoint=settings.AZURE_ENDPOINT,
        credential=credential,
    )

    try:
        poller = client.begin_analyze_document(
            model_id="prebuilt-document",
            analyze_request=AnalyzeDocumentRequest(bytes_source=pdf_bytes),
        )
        result = poller.result()
    except Exception as exc:
        if _is_retryable_azure_error(exc):
            raise
        msg = f"Estrazione Azure AI fallita: {exc}"
        raise ConnectionError(msg) from exc

    if not result.key_value_pairs and not result.documents:
        msg = "Azure AI non ha estratto alcun dato dal documento."
        raise ValueError(msg)

    extracted: dict[str, Any] = {}

    if result.key_value_pairs:
        for pair in result.key_value_pairs:
            key = pair.key.content if pair.key else None
            value = pair.value.content if pair.value else None
            if key:
                extracted[key] = value

    if result.documents:
        for doc in result.documents:
            if doc.fields:
                for field_name, field in doc.fields.items():
                    if field_name not in extracted:
                        extracted[field_name] = field.content

    logger.info(
        "Azure AI extraction completed",
        extra={"fields_count": len(extracted)},
    )
    return extracted
