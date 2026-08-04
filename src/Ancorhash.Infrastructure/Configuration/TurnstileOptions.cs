using System.ComponentModel.DataAnnotations;

namespace Ancorhash.Infrastructure.Configuration;

/// <summary>
/// Configurazione Cloudflare Turnstile, bindata dalla sezione "Turnstile"
/// (variabile d'ambiente Turnstile__SecretKey; in produzione candidata a
/// migrare su Key Vault come il resto dei segreti).
/// </summary>
public sealed class TurnstileOptions
{
    public const string SectionName = "Turnstile";

    [Required]
    public string SecretKey { get; init; } = string.Empty;
}
