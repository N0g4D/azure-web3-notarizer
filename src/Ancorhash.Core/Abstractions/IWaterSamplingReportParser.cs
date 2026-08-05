using Ancorhash.Core.Models;

namespace Ancorhash.Core.Abstractions;

/// <summary>
/// Estrae i "Parametri da campo" da un verbale di campionamento acque
/// superficiali già convertito in testo dall'OCR. Logica di dominio pura:
/// nessuna dipendenza da Azure o da altri servizi esterni.
/// </summary>
public interface IWaterSamplingReportParser
{
    /// <param name="content">Testo del documento restituito dall'OCR.</param>
    /// <param name="keyValuePairs">
    /// Coppie etichetta/valore riconosciute da Azure sui campi del modulo.
    /// Fonte secondaria: nei documenti-form il valore finisce spesso in una
    /// cella separata dall'etichetta, dove il parsing per righe non arriva.
    /// </param>
    /// <returns>
    /// Report con i campi riconosciuti; i campi assenti — o non compilati
    /// perché il modulo è vuoto — restano null. Non solleva mai eccezioni.
    /// </returns>
    WaterSamplingReport Parse(
        string content,
        IReadOnlyDictionary<string, string>? keyValuePairs = null);
}
