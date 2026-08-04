using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Ancorhash.Core.Abstractions;
using Ancorhash.Infrastructure.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ancorhash.Infrastructure.Security;

/// <summary>
/// Verifica dei token Turnstile contro l'endpoint siteverify di Cloudflare.
/// Politica fail-closed: token assente, rifiutato o Cloudflare irraggiungibile
/// → richiesta respinta. Meglio un falso positivo che il draining del wallet.
/// </summary>
public sealed class CloudflareTurnstileValidator(
    HttpClient httpClient,
    IOptions<TurnstileOptions> options,
    ILogger<CloudflareTurnstileValidator> logger) : ITurnstileValidator
{
    private const string SiteVerifyUrl =
        "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    public async Task<bool> ValidateAsync(
        string token,
        string? remoteIp,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return false;
        }

        var form = new Dictionary<string, string>
        {
            ["secret"] = options.Value.SecretKey,
            ["response"] = token,
        };
        if (!string.IsNullOrWhiteSpace(remoteIp))
        {
            form["remoteip"] = remoteIp;
        }

        try
        {
            using var response = await httpClient
                .PostAsync(SiteVerifyUrl, new FormUrlEncodedContent(form), cancellationToken)
                .ConfigureAwait(false);
            response.EnsureSuccessStatusCode();

            var result = await response.Content
                .ReadFromJsonAsync<SiteVerifyResponse>(cancellationToken)
                .ConfigureAwait(false);

            if (result is not { Success: true })
            {
                logger.LogWarning(
                    "Turnstile: token rifiutato da Cloudflare ({ErrorCodes})",
                    string.Join(",", result?.ErrorCodes ?? []));
                return false;
            }
            return true;
        }
        catch (Exception ex) when (
            ex is HttpRequestException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogError(ex, "Turnstile: endpoint siteverify non raggiungibile (fail closed)");
            return false;
        }
    }

    private sealed record SiteVerifyResponse(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("error-codes")] string[]? ErrorCodes);
}
