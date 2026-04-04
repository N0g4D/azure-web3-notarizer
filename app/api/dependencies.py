import secrets

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

from app.core.config import settings

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(
    api_key: str | None = Security(_api_key_header),
) -> str:
    """Dipendenza FastAPI: verifica l'header ``X-API-Key``.

    Il confronto avviene in tempo costante (``secrets.compare_digest``)
    per prevenire attacchi di timing.
    """
    if api_key is None or not secrets.compare_digest(api_key, settings.API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key mancante o non valida.",
        )
    return api_key
