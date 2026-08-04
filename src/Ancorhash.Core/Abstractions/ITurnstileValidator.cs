namespace Ancorhash.Core.Abstractions;

/// <summary>
/// Verifica server-side di un token anti-bot (Cloudflare Turnstile).
/// Difesa anti-draining del relayer gas-sponsored: nessuna transazione
/// viene firmata senza prova che la richiesta arrivi da un umano.
/// </summary>
public interface ITurnstileValidator
{
    /// <param name="token">Token emesso dal widget lato client.</param>
    /// <param name="remoteIp">IP del client, se noto (rafforza la verifica).</param>
    /// <returns>True solo se Cloudflare conferma la validità del token.
    /// Qualsiasi errore di rete o di verifica → false (fail closed).</returns>
    Task<bool> ValidateAsync(
        string token,
        string? remoteIp,
        CancellationToken cancellationToken = default);
}
