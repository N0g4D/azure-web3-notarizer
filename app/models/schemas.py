from pydantic import BaseModel, Field, HttpUrl, field_validator
from web3 import Web3


class WebhookPayload(BaseModel):
    """Schema di validazione per il payload in ingresso da Power Automate.

    La validazione è *strict*: nessun dato sporco tocca Azure o Polygon.
    """

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
    wallet_address: str = Field(
        ...,
        description="Indirizzo Ethereum del destinatario/emittente (EIP-55).",
    )

    @field_validator("wallet_address")
    @classmethod
    def validate_eip55_checksum(cls, v: str) -> str:
        """Verifica che l'indirizzo sia un checksum EIP-55 valido.

        Rifiuta indirizzi malformati, troppo corti/lunghi o con checksum errato.
        """
        if not v.startswith("0x") or len(v) != 42:
            msg = "L'indirizzo deve essere di 42 caratteri e iniziare con 0x."
            raise ValueError(msg)
        try:
            checksummed = Web3.to_checksum_address(v)
        except ValueError as exc:
            msg = f"Indirizzo Ethereum non valido: {exc}"
            raise ValueError(msg) from exc
        if v != checksummed:
            msg = (
                f"Checksum EIP-55 non corretto. Indirizzo atteso: {checksummed}"
            )
            raise ValueError(msg)
        return v
