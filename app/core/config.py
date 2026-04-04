from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configurazione centralizzata caricata da variabili d'ambiente / .env.

    Nessun segreto ha un valore di default: l'app non parte se manca
    anche una sola variabile obbligatoria.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Autenticazione webhook (Power Automate -> API) ---
    API_KEY: str

    # --- Ethereum / Web3 ---
    RPC_URL: str
    PRIVATE_KEY: str

    # --- Azure AI Document Intelligence ---
    AZURE_ENDPOINT: str
    AZURE_KEY: str


settings = Settings()  # type: ignore[call-arg]
