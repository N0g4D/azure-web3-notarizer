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

    public static NotarizeHttpResponse From(NotarizationResult result) => new()
    {
        DocumentId = result.DocumentId,
        DocHash = result.DocumentHash,
        TxHash = result.TransactionHash,
        ChainId = result.ChainId,
    };
}
