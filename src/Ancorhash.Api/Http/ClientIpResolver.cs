using System.Net;
using Microsoft.AspNetCore.Http;

namespace Ancorhash.Api.Http;

/// <summary>
/// Risoluzione dell'IP reale del client dietro i proxy di Azure:
/// primo hop di X-Forwarded-For (che su Azure può includere la porta),
/// con fallback sull'IP della connessione.
/// </summary>
public static class ClientIpResolver
{
    public static string Resolve(HttpContext httpContext)
    {
        var forwarded = httpContext.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwarded))
        {
            var firstHop = forwarded.Split(',')[0].Trim();
            if (IPEndPoint.TryParse(firstHop, out var endpoint))
            {
                return endpoint.Address.ToString();
            }
        }
        return httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}
