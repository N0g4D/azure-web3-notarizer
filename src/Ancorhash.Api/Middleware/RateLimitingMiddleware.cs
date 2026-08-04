using Ancorhash.Api.Contracts;
using Ancorhash.Api.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace Ancorhash.Api.Middleware;

/// <summary>
/// Rate limiting per IP sull'endpoint /api/v1/notarize (finestra fissa:
/// max 5 richieste al minuto). Difesa anti-draining del relayer: il limite
/// scatta PRIMA che la function venga eseguita, quindi prima di qualsiasi
/// chiamata a Cloudflare o al nodo RPC. Contatori in IMemoryCache con
/// scadenza automatica della finestra.
/// </summary>
public sealed class RateLimitingMiddleware(
    IMemoryCache cache,
    ILogger<RateLimitingMiddleware> logger) : IFunctionsWorkerMiddleware
{
    private const int MaxRequestsPerWindow = 5;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var httpContext = context.GetHttpContext();
        if (httpContext is null
            || !httpContext.Request.Path.StartsWithSegments("/api/v1/notarize"))
        {
            await next(context);
            return;
        }

        var clientIp = ClientIpResolver.Resolve(httpContext);
        var counter = cache.GetOrCreate($"rate:notarize:{clientIp}", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = Window;
            return new Counter();
        })!;

        if (counter.Increment() > MaxRequestsPerWindow)
        {
            logger.LogWarning(
                "Rate limit superato su /notarize per IP {ClientIp} ({MaxRequests} req/{WindowSeconds}s)",
                clientIp, MaxRequestsPerWindow, Window.TotalSeconds);
            httpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            await httpContext.Response.WriteAsJsonAsync(
                new ApiErrorResponse
                {
                    Detail = "Troppe richieste di notarizzazione. Riprova tra un minuto.",
                },
                context.CancellationToken);
            return;
        }

        await next(context);
    }

    /// <summary>Contatore thread-safe condiviso tra richieste concorrenti dello stesso IP.</summary>
    private sealed class Counter
    {
        private int _count;

        public int Increment() => Interlocked.Increment(ref _count);
    }
}
