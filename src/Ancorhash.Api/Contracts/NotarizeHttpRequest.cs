using System.Text.Json.Serialization;

namespace Ancorhash.Api.Contracts;

/// <summary>
/// Payload di POST /api/v1/notarize. Zero Data Leakage: nessun URL o
/// contenuto del documento, solo l'hash SHA-256 calcolato lato client.
/// Chiavi snake_case per compatibilità con i flussi Power Automate.
/// </summary>
public sealed record NotarizeHttpRequest
{
    [JsonPropertyName("document_id")]
    public string? DocumentId { get; init; }

    /// <summary>SHA-256 hex di 64 caratteri, senza prefisso 0x.</summary>
    [JsonPropertyName("document_hash")]
    public string? DocumentHash { get; init; }

    /// <summary>Indirizzo Ethereum destinatario, checksummato EIP-55.</summary>
    [JsonPropertyName("wallet_address")]
    public string? WalletAddress { get; init; }

    /// <summary>Chain ID EIP-155 della rete EVM di destinazione (obbligatorio, es. 80002, 11155111).</summary>
    [JsonPropertyName("chain_id")]
    public int? ChainId { get; init; }
}
