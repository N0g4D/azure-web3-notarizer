using System.Text.Json.Serialization;

namespace Ancorhash.Api.Contracts;

/// <summary>Risposta di errore uniforme (campo "detail" come nel legacy FastAPI).</summary>
public sealed record ApiErrorResponse
{
    [JsonPropertyName("status")]
    public string Status { get; init; } = "error";

    [JsonPropertyName("detail")]
    public required string Detail { get; init; }
}
