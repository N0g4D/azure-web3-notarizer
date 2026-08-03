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
    /// Modello predefinito di analisi. "prebuilt-layout" estrae testo strutturato
    /// e coppie chiave-valore; in alternativa "prebuilt-read" per solo OCR.
    /// </summary>
    [Required]
    public string ModelId { get; init; } = "prebuilt-layout";
}
