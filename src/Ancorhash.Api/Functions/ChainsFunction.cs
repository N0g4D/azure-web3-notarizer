using Ancorhash.Api.Contracts;
using Ancorhash.Core.Abstractions;
using Ancorhash.Infrastructure.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ancorhash.Api.Functions;

/// <summary>
/// GET /api/v1/chains — elenco delle reti EVM configurate sul relayer con
/// la stima costi in USD, per popolare il selettore di rete del frontend.
/// </summary>
public sealed class ChainsFunction(
    IOptions<BlockchainOptions> blockchainOptions,
    IBlockchainRelayer blockchainRelayer,
    ILogger<ChainsFunction> logger)
{
    [Function("Chains")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "v1/chains")]
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        var networks = blockchainOptions.Value.Networks;

        // Stima costi in parallelo: le mainnet fanno chiamate RPC + oracolo,
        // le testnet ritornano 0 immediatamente.
        var chains = await Task.WhenAll(networks.Select(async entry =>
        {
            var (chainId, config) = (entry.Key, entry.Value);
            var estimatedCost = 0m;
            try
            {
                estimatedCost = await blockchainRelayer
                    .EstimateFiatCostAsync(chainId, cancellationToken);
            }
            catch (Exception ex)
            {
                // Una stima non disponibile non deve far fallire l'intero endpoint,
                // ma va segnalata a livello Error: un costo 0 su mainnet è un difetto,
                // non un dato di business.
                logger.LogError(ex,
                    "Stima costo non disponibile per chain {ChainId}, fallback a 0", chainId);
            }

            return new ChainInfo
            {
                ChainId = chainId,
                Name = config.Name ?? $"Chain {chainId}",
                EstimatedCostUsd = estimatedCost,
                IsFree = config.IsTestnet,
            };
        }));

        var ordered = chains
            .OrderBy(chain => chain.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new OkObjectResult(ChainsHttpResponse.From(ordered));
    }
}
