import logging
import sys

from pythonjsonlogger.json import JsonFormatter


def setup_logger(name: str = "rwa", level: int = logging.INFO) -> logging.Logger:
    """Restituisce un logger che emette esclusivamente JSON strutturato.

    Ogni riga include almeno ``timestamp`` (ISO 8601) e ``level``.
    Il chiamante può aggiungere campi extra (es. ``document_id``) tramite
    ``logger.info("msg", extra={"document_id": "..."})``.
    """
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger

    logger.setLevel(level)

    handler = logging.StreamHandler(sys.stdout)
    formatter = JsonFormatter(
        fmt="%(asctime)s %(levelname)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level"},
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False

    return logger


logger = setup_logger()
