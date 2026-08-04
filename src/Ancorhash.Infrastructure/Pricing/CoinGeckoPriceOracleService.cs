using System.Net.Http.Json;
using Ancorhash.Core.Abstractions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace Ancorhash.Infrastructure.Pricing;

/// <summary>
/// Oracolo dei prezzi basato sull'API pubblica gratuita di CoinGecko.
/// Ogni prezzo è cachato 5 minuti in IMemoryCache per non incappare nel
/// rate limit del tier gratuito. Politica resiliente: qualsiasi errore di
/// rete o risposta inattesa → null (il chiamante decide il fallback).
/// </summary>
public sealed class CoinGeckoPriceOracleService(
    IHttpClientFactory httpClientFactory,
    IMemoryCache cache,
    ILogger<CoinGeckoPriceOracleService> logger) : IPriceOracleService
{
    public const string HttpClientName = "coingecko";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    public async Task<decimal?> GetUsdPriceAsync(
        string coinId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(coinId))
        {
            return null;
        }

        var cacheKey = $"price:usd:{coinId}";
        if (cache.TryGetValue(cacheKey, out decimal cached))
        {
            return cached;
        }

        try
        {
            var url =
                $"simple/price?ids={Uri.EscapeDataString(coinId)}&vs_currencies=usd";
            var client = httpClientFactory.CreateClient(HttpClientName);

            using var response = await client
                .GetAsync(url, cancellationToken)
                .ConfigureAwait(false);

            // Lo status va loggato esplicitamente: 403 (User-Agent mancante) e
            // 429 (rate limit del tier gratuito) sono i due fallimenti tipici.
            if (!response.IsSuccessStatusCode)
            {
                logger.LogError(
                    "CoinGecko: risposta {StatusCode} per {CoinId} — prezzo non disponibile",
                    (int)response.StatusCode, coinId);
                return null;
            }

            // Forma: { "ethereum": { "usd": 3456.78 } }
            var payload = await response.Content
                .ReadFromJsonAsync<Dictionary<string, Dictionary<string, decimal>>>(
                    cancellationToken)
                .ConfigureAwait(false);

            if (payload is not null
                && payload.TryGetValue(coinId, out var quotes)
                && quotes.TryGetValue("usd", out var usd))
            {
                cache.Set(cacheKey, usd, CacheTtl);
                logger.LogInformation(
                    "CoinGecko: prezzo {CoinId} = {Usd} USD (cache {Minutes}m)",
                    coinId, usd, CacheTtl.TotalMinutes);
                return usd;
            }

            logger.LogWarning("CoinGecko: nessun prezzo USD per la coin {CoinId}", coinId);
            return null;
        }
        catch (Exception ex) when (
            ex is HttpRequestException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogError(ex, "CoinGecko: recupero prezzo fallito per {CoinId}", coinId);
            return null;
        }
    }
}
