using Ancorhash.Core.Models;

namespace Ancorhash.Core.Abstractions;

/// <summary>
/// Estrazione OCR intelligente di dati da documenti (PDF o immagini).
/// Il file viaggia esclusivamente come Stream in memoria: nessun I/O su disco.
/// Implementato in Infrastructure (Azure AI Document Intelligence).
/// </summary>
public interface IDocumentExtractionService
{
    /// <param name="content">Contenuto binario del documento (mai persistito su disco).</param>
    /// <param name="contentType">MIME type del file (es. application/pdf, image/png).</param>
    /// <exception cref="Exceptions.DocumentExtractionValidationException">File vuoto, content type non supportato o documento senza contenuto estraibile.</exception>
    /// <exception cref="Exceptions.DocumentExtractionThrottledException">Quota/rate limit del servizio AI superato.</exception>
    /// <exception cref="Exceptions.DocumentExtractionUnavailableException">Servizio AI non raggiungibile o in errore.</exception>
    Task<DocumentExtractionResult> ExtractAsync(
        Stream content,
        string contentType,
        CancellationToken cancellationToken = default);
}
