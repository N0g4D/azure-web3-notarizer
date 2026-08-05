using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Ancorhash.Core.Models;
using Ancorhash.Infrastructure.Configuration;
using Azure;
using Azure.AI.DocumentIntelligence;
using Azure.Core;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ancorhash.Infrastructure.DocumentIntelligence;

/// <summary>
/// Estrazione OCR via Azure AI Document Intelligence (SDK Azure.AI.DocumentIntelligence).
/// Il documento resta sempre in memoria (Stream → BinaryData): nessun file temporaneo
/// su disco. Autenticazione con DefaultAzureCredential (Managed Identity in cloud),
/// stesso pattern del Key Vault. Singleton: il client HTTP è creato una sola volta.
/// </summary>
public sealed class AzureDocumentExtractionService : IDocumentExtractionService
{
    private static readonly HashSet<string> SupportedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/bmp",
        "image/heif",
    };

    private readonly DocumentIntelligenceOptions _options;
    private readonly ILogger<AzureDocumentExtractionService> _logger;
    private readonly Lazy<DocumentIntelligenceClient> _client;

    public AzureDocumentExtractionService(
        IOptions<DocumentIntelligenceOptions> options,
        TokenCredential credential,
        ILogger<AzureDocumentExtractionService> logger)
    {
        _options = options.Value;
        _logger = logger;
        _client = new Lazy<DocumentIntelligenceClient>(
            () => CreateClient(credential),
            LazyThreadSafetyMode.ExecutionAndPublication);
    }

    private DocumentIntelligenceClient CreateClient(TokenCredential credential)
    {
        var endpoint = new Uri(_options.Endpoint);

        // Keyless per default; la chiave, se configurata, resta un ripiego per
        // ambienti dove RBAC su Entra ID non è disponibile.
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            _logger.LogInformation(
                "Document Intelligence: autenticazione keyless (DefaultAzureCredential) su {Endpoint}",
                endpoint);
            return new DocumentIntelligenceClient(endpoint, credential);
        }

        _logger.LogWarning(
            "Document Intelligence: autenticazione tramite chiave API su {Endpoint}. "
            + "Preferire Managed Identity: la chiave va comunque letta da configurazione/Key Vault.",
            endpoint);
        return new DocumentIntelligenceClient(endpoint, new AzureKeyCredential(_options.ApiKey));
    }

    public async Task<DocumentExtractionResult> ExtractAsync(
        Stream content,
        string contentType,
        CancellationToken cancellationToken = default)
    {
        if (!SupportedContentTypes.Contains(contentType))
        {
            throw new DocumentExtractionValidationException(
                $"Content type '{contentType}' non supportato. Formati ammessi: PDF, JPEG, PNG, TIFF, BMP, HEIF.");
        }

        var binaryData = await BinaryData.FromStreamAsync(content, cancellationToken)
            .ConfigureAwait(false);
        if (binaryData.ToMemory().IsEmpty)
        {
            throw new DocumentExtractionValidationException("Il file inviato è vuoto.");
        }

        _logger.LogInformation(
            "Estrazione avviata per stream di {Length} bytes, content type {ContentType}, modello {ModelId}",
            binaryData.ToMemory().Length, contentType, _options.ModelId);

        AnalyzeResult analysis;
        try
        {
            var analyzeOptions = new AnalyzeDocumentOptions(_options.ModelId, binaryData)
            {
                Features = { DocumentAnalysisFeature.KeyValuePairs },
            };

            var operation = await _client.Value
                .AnalyzeDocumentAsync(WaitUntil.Completed, analyzeOptions, cancellationToken)
                .ConfigureAwait(false);
            analysis = operation.Value;
        }
        catch (RequestFailedException ex) when (ex.Status is 429 or 503)
        {
            throw new DocumentExtractionThrottledException(
                "Quota Azure AI superata. Riprovare più tardi.", ex);
        }
        catch (RequestFailedException ex)
        {
            throw new DocumentExtractionUnavailableException(
                $"Azure AI Document Intelligence ha risposto con errore {ex.Status}.", ex);
        }

        // Chiavi duplicate possibili nel documento: vince la prima occorrenza.
        var keyValuePairs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in analysis.KeyValuePairs)
        {
            if (!string.IsNullOrWhiteSpace(pair.Key?.Content) && pair.Value is not null)
            {
                keyValuePairs.TryAdd(pair.Key.Content, pair.Value.Content ?? string.Empty);
            }
        }

        if (string.IsNullOrWhiteSpace(analysis.Content) && keyValuePairs.Count == 0)
        {
            throw new DocumentExtractionValidationException(
                "Nessun contenuto estraibile dal documento fornito.");
        }

        _logger.LogInformation(
            "Estrazione completata: {ContentLength} caratteri, {KeyValueCount} coppie chiave-valore, {PageCount} pagine",
            analysis.Content?.Length ?? 0, keyValuePairs.Count, analysis.Pages.Count);

        return new DocumentExtractionResult(
            analysis.Content ?? string.Empty,
            keyValuePairs,
            analysis.Pages.Count);
    }
}
