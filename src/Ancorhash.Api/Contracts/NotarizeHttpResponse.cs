using System.Text.Json.Serialization;
using Ancorhash.Core.Models;

namespace Ancorhash.Api.Contracts;

/// <summary>Risposta 200 di POST /api/v1/notarize (stesso contratto del legacy).</summary>
public sealed record NotarizeHttpResponse
{
    [JsonPropertyName("status")]
    public string Status { get; init; } = "success";

    [JsonPropertyName("document_id")]
    public required string DocumentId { get; init; }

    [JsonPropertyName("doc_hash")]
    public required string DocHash { get; init; }

    [JsonPropertyName("tx_hash")]
    public required string TxHash { get; init; }

    [JsonPropertyName("chain_id")]
    public required int ChainId { get; init; }

    /// <summary>Chiave dell'entità Arkiv: l'indice pubblico interrogabile.</summary>
    [JsonPropertyName("arkiv_entity_key")]
    public required string ArkivEntityKey { get; init; }

    /// <summary>Blocco Tiramisu di scadenza dell'entità. Stringa: è un uint64.</summary>
    [JsonPropertyName("arkiv_expires_at_block")]
    public required string ArkivExpiresAtBlock { get; init; }

    /// <summary>
    /// False se l'ancora on-chain è riuscita ma l'indicizzazione Arkiv no.
    /// La notarizzazione resta valida: la prova è la transazione.
    /// </summary>
    [JsonPropertyName("arkiv_indexed")]
    public required bool ArkivIndexed { get; init; }

    public static NotarizeHttpResponse From(NotarizationResult result) => new()
    {
        DocumentId = result.DocumentId,
        DocHash = result.DocumentHash,
        TxHash = result.TransactionHash,
        ChainId = result.ChainId,
        ArkivEntityKey = result.ArkivEntityKey,
        ArkivExpiresAtBlock = result.ArkivExpiresAtBlock.ToString(),
        ArkivIndexed = result.ArkivIndexed,
    };
}
