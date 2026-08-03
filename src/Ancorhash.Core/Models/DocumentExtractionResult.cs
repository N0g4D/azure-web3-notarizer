namespace Ancorhash.Core.Models;

/// <summary>Esito dell'estrazione OCR intelligente di un documento.</summary>
/// <param name="Content">Testo completo estratto dal documento.</param>
/// <param name="KeyValuePairs">Coppie chiave-valore rilevate (es. campi di un certificato).</param>
/// <param name="PageCount">Numero di pagine analizzate.</param>
public sealed record DocumentExtractionResult(
    string Content,
    IReadOnlyDictionary<string, string> KeyValuePairs,
    int PageCount);
