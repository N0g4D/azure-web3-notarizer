using System.Text.Json.Serialization;

namespace Ancorhash.Api.Contracts;

/// <summary>Singola rete EVM esposta al frontend.</summary>
public sealed record ChainInfo
{
    [JsonPropertyName("chain_id")]
    public required int ChainId { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>Costo stimato della notarizzazione in USD (0 per le testnet).</summary>
    [JsonPropertyName("estimated_cost_usd")]
    public required decimal EstimatedCostUsd { get; init; }

    /// <summary>True se la rete è una testnet: notarizzazione gratuita.</summary>
    [JsonPropertyName("is_free")]
    public required bool IsFree { get; init; }
}

/// <summary>
/// Risposta 200 di GET /api/v1/chains. Espone SOLO dati pubblici (chain_id,
/// nome, stima costo): gli RPC URL (con eventuali API key) e i segreti non
/// escono mai dal backend.
/// </summary>
public sealed record ChainsHttpResponse
{
    [JsonPropertyName("status")]
    public string Status { get; init; } = "success";

    [JsonPropertyName("chains")]
    public required IReadOnlyList<ChainInfo> Chains { get; init; }

    public static ChainsHttpResponse From(IReadOnlyList<ChainInfo> chains) => new()
    {
        Chains = chains,
    };
}
