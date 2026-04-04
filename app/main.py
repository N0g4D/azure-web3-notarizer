"""Punto d'ingresso dell'applicazione FastAPI.

Avvio: ``uvicorn app.main:app --reload``
"""

import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.v1.endpoints import router as webhook_router
from app.core.logger import logger

app = FastAPI(
    title="Ancorhash",
    description=(
        "Notarizzazione RWA per la Compliance B2B — "
        "estrazione documentale (Azure AI) e anchoring on-chain (Ethereum)."
    ),
    version="0.1.0",
)

app.include_router(webhook_router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Cattura qualsiasi eccezione non gestita e restituisce un 500 pulito.

    Lo stack trace completo viene loggato in JSON ma MAI esposto al client.
    """
    logger.error(
        "Errore critico non gestito: %s\n%s",
        exc,
        traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Errore interno del server."},
    )


@app.get("/health", tags=["infra"])
async def health_check() -> dict:
    """Liveness probe minimale."""
    return {"status": "ok"}
