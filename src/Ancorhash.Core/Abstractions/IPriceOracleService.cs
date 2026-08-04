namespace Ancorhash.Core.Abstractions;

/// <summary>
/// Oracolo dei prezzi delle coin native (per la stima costi in USD del billing).
/// L'implementazione è responsabile del caching per rispettare i rate limit
/// del provider esterno.
/// </summary>
public interface IPriceOracleService
{
    /// <param name="coinId">Identificativo della coin presso il provider (es. "ethereum", "matic-network").</param>
    /// <returns>Prezzo corrente in USD, oppure null se non disponibile (nessuna eccezione propagata).</returns>
    Task<decimal?> GetUsdPriceAsync(string coinId, CancellationToken cancellationToken = default);
}
