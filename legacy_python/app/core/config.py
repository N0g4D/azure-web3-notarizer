import re
from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_HEX64_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")

# Risali alla root del progetto indipendentemente dal CWD di avvio.
# Struttura: app/core/config.py → root è 2 livelli sopra "app/".
_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    """Configurazione centralizzata caricata da variabili d'ambiente / .env.

    Nessun segreto ha un valore di default: l'app non parte se manca
    anche una sola variabile obbligatoria.
    """

    model_config = SettingsConfigDict(
        env_file=str(_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Autenticazione webhook (Power Automate -> API) ---
    API_KEY: SecretStr

    # --- Ethereum / Web3 ---
    RPC_URL: str
    PRIVATE_KEY: SecretStr

    # --- Azure AI Document Intelligence ---
    AZURE_ENDPOINT: str
    AZURE_KEY: SecretStr

    @field_validator("PRIVATE_KEY")
    @classmethod
    def validate_private_key(cls, v: SecretStr) -> SecretStr:
        raw = v.get_secret_value() if isinstance(v, SecretStr) else v
        if not _HEX64_RE.match(raw):
            raise ValueError(
                "PRIVATE_KEY deve essere 66 caratteri: prefisso 0x + 64 hex digits."
            )
        return v


settings = Settings()  # type: ignore[call-arg]
