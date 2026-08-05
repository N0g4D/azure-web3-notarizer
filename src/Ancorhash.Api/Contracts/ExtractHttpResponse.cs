using System.Text.Json.Serialization;
using Ancorhash.Core.Models;

namespace Ancorhash.Api.Contracts;

/// <summary>
/// Parametri da campo del verbale di campionamento acque, tipizzati.
/// Un campo null significa "non rilevato nel documento".
/// </summary>
public sealed record WaterSamplingFieldData
{
    [JsonPropertyName("corso_acqua")]
    public string? CorsoAcqua { get; init; }

    [JsonPropertyName("data_prelievo")]
    public string? DataPrelievo { get; init; }

    [JsonPropertyName("temperatura_acqua_c")]
    public decimal? TemperaturaAcquaCelsius { get; init; }

    [JsonPropertyName("ph")]
    public decimal? Ph { get; init; }

    [JsonPropertyName("ossigeno_disciolto_mg_l")]
    public decimal? OssigenoDiscioltoMgL { get; init; }

    /// <summary>False se il documento non conteneva alcun parametro compilato.</summary>
    [JsonPropertyName("has_any_value")]
    public required bool HasAnyValue { get; init; }

    public static WaterSamplingFieldData From(WaterSamplingReport report) => new()
    {
        CorsoAcqua = report.CorsoAcqua,
        // ISO 8601: la localizzazione è responsabilità del frontend.
        DataPrelievo = report.DataPrelievo?.ToString("yyyy-MM-dd"),
        TemperaturaAcquaCelsius = report.TemperaturaAcquaCelsius,
        Ph = report.Ph,
        OssigenoDiscioltoMgL = report.OssigenoDiscioltoMgL,
        HasAnyValue = report.HasAnyValue,
    };
}

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

    /// <summary>Parametri da campo riconosciuti nel verbale.</summary>
    [JsonPropertyName("field_data")]
    public required WaterSamplingFieldData FieldData { get; init; }

    public static ExtractHttpResponse From(
        string fileName,
        DocumentExtractionResult result,
        WaterSamplingReport report) => new()
    {
        FileName = fileName,
        Content = result.Content,
        KeyValuePairs = result.KeyValuePairs,
        PageCount = result.PageCount,
        FieldData = WaterSamplingFieldData.From(report),
    };
}
