using System.ComponentModel.DataAnnotations;

namespace Ancorhash.Infrastructure.Configuration;

/// <summary>
/// Configurazione di Azure AI Document Intelligence, bindata dalla sezione "AI"
/// (variabile d'ambiente AI__Endpoint). Autenticazione via DefaultAzureCredential:
/// nessuna chiave API testuale. Con ValidateOnStart l'app non parte se manca l'endpoint.
/// </summary>
public sealed class DocumentIntelligenceOptions
{
    public const string SectionName = "AI";

    [Required, Url]
    public string Endpoint { get; init; } = string.Empty;

    /// <summary>
    /// Chiave del servizio (config <c>AI:ApiKey</c>). Opzionale e sconsigliata:
    /// se valorizzata prevale sull'autenticazione keyless. Va fornita solo da
    /// configurazione o Key Vault, mai nel codice. Lasciarla vuota per usare
    /// DefaultAzureCredential (Managed Identity in cloud, az login in locale).
    /// </summary>
    public string? ApiKey { get; init; }

    /// <summary>
    /// Modello predefinito di analisi. "prebuilt-layout" estrae testo strutturato
    /// e coppie chiave-valore; in alternativa "prebuilt-read" per solo OCR.
    /// </summary>
    [Required]
    public string ModelId { get; init; } = "prebuilt-layout";
}
