using Ancorhash.Api.Contracts;
using Ancorhash.Infrastructure.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Options;

namespace Ancorhash.Api.Functions;

/// <summary>
/// GET /api/v1/chains — elenco delle reti EVM configurate sul relayer,
/// per popolare il selettore di rete del frontend.
/// </summary>
public sealed class ChainsFunction(IOptions<BlockchainOptions> blockchainOptions)
{
    [Function("Chains")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "v1/chains")]
        HttpRequest request)
    {
        return new OkObjectResult(ChainsHttpResponse.From(blockchainOptions.Value));
    }
}
