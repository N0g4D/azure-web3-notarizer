using System.Text.Json.Serialization;
using Ancorhash.Infrastructure.Configuration;

namespace Ancorhash.Api.Contracts;

/// <summary>Singola rete EVM esposta al frontend.</summary>
public sealed record ChainInfo
{
    [JsonPropertyName("chain_id")]
    public required int ChainId { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }
}

/// <summary>
/// Risposta 200 di GET /api/v1/chains. Espone SOLO chain_id e nome:
/// gli RPC URL (con eventuali API key) e i segreti non escono mai dal backend.
/// </summary>
public sealed record ChainsHttpResponse
{
    [JsonPropertyName("status")]
    public string Status { get; init; } = "success";

    [JsonPropertyName("chains")]
    public required IReadOnlyList<ChainInfo> Chains { get; init; }

    public static ChainsHttpResponse From(BlockchainOptions options) => new()
    {
        Chains =
        [
            .. options.Networks
                .Select(network => new ChainInfo
                {
                    ChainId = network.Key,
                    Name = network.Value.Name ?? $"Chain {network.Key}",
                })
                .OrderBy(chain => chain.Name, StringComparer.OrdinalIgnoreCase),
        ],
    };
}
