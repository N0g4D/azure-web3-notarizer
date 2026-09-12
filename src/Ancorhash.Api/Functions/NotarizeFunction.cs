using System.Text.Json;
using Ancorhash.Api.Contracts;
using Ancorhash.Api.Http;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Ancorhash.Core.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using static Ancorhash.Api.Contracts.ApiResults;

namespace Ancorhash.Api.Functions;

/// <summary>
/// POST /api/v1/notarize — ancora on-chain un hash SHA-256 calcolato lato client.
/// Autenticazione: function key nativa di Azure Functions (sostituisce il
/// custom header X-API-Key del legacy).
/// </summary>
public sealed class NotarizeFunction(
    INotarizationService notarizationService,
    ITurnstileValidator turnstileValidator,
    ILogger<NotarizeFunction> logger)
{
    [Function("Notarize")]
    public async Task<IActionResult> RunAsync(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "v1/notarize")]
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        NotarizeHttpRequest? payload;
        try
        {
            payload = await request.ReadFromJsonAsync<NotarizeHttpRequest>(cancellationToken);
        }
        catch (JsonException)
        {
            return Error(StatusCodes.Status400BadRequest, "Body JSON non valido.");
        }

        if (payload is null)
        {
            return Error(StatusCodes.Status400BadRequest, "Body della richiesta mancante.");
        }

        // Difesa anti-draining: la verifica anti-bot avviene PRIMA di ogni
        // validazione di dominio e di ogni interazione con la blockchain.
        var clientIp = ClientIpResolver.Resolve(request.HttpContext);
        var isTokenValid = await turnstileValidator.ValidateAsync(
            payload.TurnstileToken ?? string.Empty, clientIp, cancellationToken);
        if (!isTokenValid)
        {
            logger.LogWarning(
                "Notarize bloccata: verifica Turnstile fallita per IP {ClientIp}", clientIp);
            return Error(StatusCodes.Status403Forbidden,
                "Verifica anti-bot fallita. Aggiorna la pagina e riprova.");
        }

        var command = new NotarizationCommand(
            DocumentId: payload.DocumentId ?? string.Empty,
            DocumentHash: payload.DocumentHash ?? string.Empty,
            WalletAddress: payload.WalletAddress ?? string.Empty,
            ChainId: payload.ChainId ?? 0,
            SwarmAddress: payload.SwarmAddress ?? string.Empty,
            ExpirationSeconds: payload.ExpirationSeconds ?? 0);

        try
        {
            var result = await notarizationService.NotarizeAsync(command, cancellationToken);
            return new OkObjectResult(NotarizeHttpResponse.From(result));
        }
        catch (NotarizationValidationException ex)
        {
            logger.LogWarning(
                "Notarize rifiutata per documento {DocumentId}: {Reason}",
                command.DocumentId, ex.Message);
            return Error(StatusCodes.Status400BadRequest, ex.Message);
        }
        catch (UnsupportedChainException ex)
        {
            logger.LogWarning(
                "Notarize rifiutata per documento {DocumentId}: chain {ChainId} non supportata",
                command.DocumentId, ex.ChainId);
            return Error(StatusCodes.Status400BadRequest, ex.Message);
        }
        catch (DuplicateNotarizationException ex)
        {
            // Non è un guasto: è la regola d'asset del contratto.
            // tokenId == uint256(documentHash), quindi un documento si
            // notarizza una volta sola. 409, non 500.
            logger.LogInformation(
                "Notarize rifiutata per documento {DocumentId}: hash già notarizzato on-chain",
                command.DocumentId);
            return Error(StatusCodes.Status409Conflict, ex.Message);
        }
        catch (ArkivIndexingException ex)
        {
            // Arkiv gira prima del relayer: qui nessun gas è stato speso.
            logger.LogError(ex,
                "Indicizzazione Arkiv fallita per documento {DocumentId} (codice {Code})",
                command.DocumentId, ex.Code);
            return Error(StatusCodes.Status502BadGateway,
                $"Indicizzazione su Arkiv fallita: {ex.Message}");
        }
        catch (BlockchainUnavailableException ex)
        {
            logger.LogError(ex,
                "Nodo RPC non raggiungibile per documento {DocumentId}", command.DocumentId);
            return Error(StatusCodes.Status502BadGateway,
                "Nodo blockchain non raggiungibile. Riprovare più tardi.");
        }
        catch (BlockchainTransactionException ex)
        {
            logger.LogError(ex,
                "Notarizzazione on-chain fallita per documento {DocumentId}", command.DocumentId);
            return Error(StatusCodes.Status500InternalServerError, ex.InnerException?.Message ?? ex.Message);
        }
    }
}
