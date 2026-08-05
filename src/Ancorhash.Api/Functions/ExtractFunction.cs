using Ancorhash.Api.Contracts;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using static Ancorhash.Api.Contracts.ApiResults;

namespace Ancorhash.Api.Functions;

/// <summary>
/// POST /api/v1/extract — estrazione OCR intelligente da PDF o immagine
/// inviati via multipart/form-data (campo "file"). Il documento resta
/// sempre in memoria: nessun file temporaneo su disco.
/// </summary>
public sealed class ExtractFunction(
    IDocumentExtractionService extractionService,
    IWaterSamplingReportParser reportParser,
    ILogger<ExtractFunction> logger)
{
    [Function("Extract")]
    public async Task<IActionResult> RunAsync(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "v1/extract")]
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType)
        {
            return Error(StatusCodes.Status400BadRequest,
                "La richiesta deve essere multipart/form-data con un campo file.");
        }

        IFormFile? file;
        try
        {
            var form = await request.ReadFormAsync(cancellationToken);
            file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
        }
        catch (InvalidDataException)
        {
            return Error(StatusCodes.Status400BadRequest,
                "Payload multipart/form-data non valido.");
        }

        if (file is null || file.Length == 0)
        {
            return Error(StatusCodes.Status400BadRequest,
                "Nessun file presente nella richiesta (campo atteso: \"file\").");
        }

        try
        {
            await using var stream = file.OpenReadStream();
            var result = await extractionService.ExtractAsync(
                stream, file.ContentType, cancellationToken);

            // Parsing di dominio: dal testo OCR ai parametri da campo tipizzati.
            // Non solleva eccezioni: al più restituisce un report vuoto.
            var report = reportParser.Parse(result.Content, result.KeyValuePairs);

            logger.LogInformation(
                "Extract completata per {FileName} ({Length} bytes), parametri rilevati: {HasFieldData}",
                file.FileName, file.Length, report.HasAnyValue);
            return new OkObjectResult(
                ExtractHttpResponse.From(file.FileName, result, report));
        }
        catch (DocumentExtractionValidationException ex)
        {
            logger.LogWarning(
                "Extract rifiutata per {FileName}: {Reason}", file.FileName, ex.Message);
            return Error(StatusCodes.Status400BadRequest, ex.Message);
        }
        catch (DocumentExtractionThrottledException ex)
        {
            logger.LogWarning(ex,
                "Extract throttled per {FileName}: quota Azure AI superata", file.FileName);
            return Error(StatusCodes.Status429TooManyRequests, ex.Message);
        }
        catch (DocumentExtractionUnavailableException ex)
        {
            logger.LogError(ex,
                "Extract fallita per {FileName}: servizio AI non disponibile", file.FileName);
            return Error(StatusCodes.Status502BadGateway,
                "Azure AI Document Intelligence non raggiungibile.");
        }
    }
}
