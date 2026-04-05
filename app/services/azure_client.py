"""Client asincrono per download PDF e estrazione dati via Azure AI Document Intelligence.

Nessuna dipendenza da FastAPI: solleva eccezioni Python standard.
"""

import asyncio
import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import httpx
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import (
    AnalyzeDocumentRequest,
    DocumentAnalysisFeature,
)
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
_MAX_REDIRECTS = 3


def _is_private_ip_sync(hostname: str) -> bool:
    """Risolve il hostname e verifica che NON punti a IP privati/riservati (sync)."""
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return True  # DNS non risolvibile → blocca per sicurezza

    for _, _, _, _, sockaddr in addr_info:
        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return True
    return False


async def _validate_url(url: str) -> str:
    """Valida l'URL contro SSRF: solo HTTPS, no IP privati.

    La risoluzione DNS viene delegata a un thread per non bloccare l'event loop.
    """
    parsed = urlparse(url)

    if parsed.scheme != "https":
        raise ValueError(f"Solo HTTPS è permesso, ricevuto: {parsed.scheme}://")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL senza hostname.")

    is_private = await asyncio.to_thread(_is_private_ip_sync, hostname)
    if is_private:
        raise ValueError("URL che punta a rete interna/privata non permesso.")

    return url


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
    await _validate_url(document_url)

    try:
        async with httpx.AsyncClient(
            timeout=_DOWNLOAD_TIMEOUT,
            max_redirects=_MAX_REDIRECTS,
            follow_redirects=True,
        ) as client:
            async with client.stream("GET", document_url) as response:
                response.raise_for_status()

                # Check Content-Length anticipato (se dichiarato)
                content_length = response.headers.get("content-length")
                if content_length is not None and int(content_length) > _MAX_PDF_BYTES:
                    msg = f"PDF troppo grande: {content_length} bytes (max {_MAX_PDF_BYTES})"
                    raise ValueError(msg)

                # Streaming con limite hard — interrompe appena supera il cap
                chunks: list[bytes] = []
                downloaded = 0
                async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                    downloaded += len(chunk)
                    if downloaded > _MAX_PDF_BYTES:
                        msg = f"PDF troppo grande: >{_MAX_PDF_BYTES} bytes (stream interrotto)"
                        raise ValueError(msg)
                    chunks.append(chunk)

    except ValueError:
        raise  # rilancia i nostri ValueError (size limit)
    except httpx.HTTPStatusError as exc:
        msg = f"Download PDF fallito — HTTP {exc.response.status_code}"
        raise ConnectionError(msg) from exc
    except httpx.TimeoutException as exc:
        msg = f"Download PDF in timeout dopo {_DOWNLOAD_TIMEOUT}s"
        raise ConnectionError(msg) from exc
    except httpx.HTTPError as exc:
        msg = f"Errore di rete durante il download del PDF: {exc}"
        raise ConnectionError(msg) from exc

    pdf_bytes = b"".join(chunks)

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

    Usa il modello ``prebuilt-layout`` con feature add-on ``KEY_VALUE_PAIRS``
    (sostituto di ``prebuilt-document``, deprecato in API v4.0 2024-11-30).
    Le chiamate vengono ritentate automaticamente in caso di errori 429 / 503
    (max 3 tentativi, backoff esponenziale).

    Raises:
        ConnectionError: Se Azure non è raggiungibile dopo i retry.
        ValueError: Se l'estrazione non produce risultati utili.
    """
    def _analyze_sync(pdf: bytes):
        """Esegue l'analisi Azure in un thread separato (SDK sincrono)."""
        credential = AzureKeyCredential(settings.AZURE_KEY.get_secret_value())
        client = DocumentIntelligenceClient(
            endpoint=settings.AZURE_ENDPOINT,
            credential=credential,
        )
        poller = client.begin_analyze_document(
            model_id="prebuilt-layout",
            body=AnalyzeDocumentRequest(bytes_source=pdf),
            features=[DocumentAnalysisFeature.KEY_VALUE_PAIRS],
        )
        return poller.result()

    try:
        result = await asyncio.to_thread(_analyze_sync, pdf_bytes)
    except Exception as exc:
        if _is_retryable_azure_error(exc):
            raise
        msg = f"Estrazione Azure AI fallita: {exc}"
        raise ConnectionError(msg) from exc

    has_content = result.content or result.key_value_pairs or result.pages
    if not has_content:
        msg = "Azure AI non ha estratto alcun dato dal documento."
        raise ValueError(msg)

    extracted: dict[str, Any] = {}

    # Key-value pairs (add-on feature)
    if result.key_value_pairs:
        for pair in result.key_value_pairs:
            key = pair.key.content if pair.key else None
            value = pair.value.content if pair.value else None
            if key:
                extracted[key] = value

    # Testo completo estratto dal documento
    if result.content:
        extracted["_raw_content"] = result.content

    logger.info(
        "Azure AI extraction completed",
        extra={"fields_count": len(extracted)},
    )
    return extracted
