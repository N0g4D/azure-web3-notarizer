using System.Text.Json.Serialization;
using Ancorhash.Core.Models;

namespace Ancorhash.Api.Contracts;

/// <summary>Risposta 200 di POST /api/v1/extract.</summary>
public sealed record ExtractHttpResponse
{
    [JsonPropertyName("status")]
    public string Status { get; init; } = "success";

    [JsonPropertyName("file_name")]
    public required string FileName { get; init; }

    [JsonPropertyName("content")]
    public required string Content { get; init; }

    [JsonPropertyName("key_value_pairs")]
    public required IReadOnlyDictionary<string, string> KeyValuePairs { get; init; }

    [JsonPropertyName("page_count")]
    public required int PageCount { get; init; }

    public static ExtractHttpResponse From(string fileName, DocumentExtractionResult result) => new()
    {
        FileName = fileName,
        Content = result.Content,
        KeyValuePairs = result.KeyValuePairs,
        PageCount = result.PageCount,
    };
}
