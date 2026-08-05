namespace Ancorhash.Core.Models;

/// <summary>
/// Parametri da campo estratti da un "Verbale di campionamento —
/// monitoraggio acque superficiali". Ogni campo è null quando non è
/// presente nel documento o quando il modulo è ancora da compilare.
/// </summary>
/// <param name="CorsoAcqua">Denominazione del corso d'acqua.</param>
/// <param name="DataPrelievo">Data del sopralluogo/prelievo.</param>
/// <param name="TemperaturaAcquaCelsius">Temperatura dell'acqua in °C (distinta da quella dell'aria).</param>
/// <param name="Ph">Valore di pH in unità pH (0–14).</param>
/// <param name="OssigenoDiscioltoMgL">Ossigeno disciolto in mg/l (concentrazione, non % di saturazione).</param>
public sealed record WaterSamplingReport(
    string? CorsoAcqua,
    DateOnly? DataPrelievo,
    decimal? TemperaturaAcquaCelsius,
    decimal? Ph,
    decimal? OssigenoDiscioltoMgL)
{
    /// <summary>True se almeno un parametro da campo è stato riconosciuto.</summary>
    public bool HasAnyValue =>
        CorsoAcqua is not null
        || DataPrelievo is not null
        || TemperaturaAcquaCelsius is not null
        || Ph is not null
        || OssigenoDiscioltoMgL is not null;

    public static WaterSamplingReport Empty { get; } = new(null, null, null, null, null);
}
