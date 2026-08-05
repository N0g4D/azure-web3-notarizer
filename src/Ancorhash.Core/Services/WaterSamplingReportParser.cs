using System.Globalization;
using System.Text.RegularExpressions;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Models;
using Microsoft.Extensions.Logging;

namespace Ancorhash.Core.Services;

/// <summary>
/// Parsing dei "Parametri da campo" da un verbale di campionamento acque
/// superficiali (modello ARPA/discariche, rev. 2022).
///
/// Il modello reale impone tre accortezze, tutte gestite qui:
/// 1. il modulo non compilato contiene placeholder (<c>____</c>, <c>|__|</c>):
///    vanno riconosciuti come "non rilevato", mai restituiti come valore;
/// 2. le pagine di istruzioni allegate al verbale contengono valori di esempio
///    (es. "valori normali 7,8-8,8 U pH") che falserebbero l'estrazione: il
///    testo viene troncato prima di quella sezione;
/// 3. esistono campi omografi da non confondere — "Temperatura aria" e
///    "Temperatura sonda" vs "Temperatura acqua", e la "% di saturazione"
///    vs la concentrazione di ossigeno in mg/l.
/// </summary>
public sealed partial class WaterSamplingReportParser(
    ILogger<WaterSamplingReportParser> logger) : IWaterSamplingReportParser
{
    /// <summary>Intestazione che separa il verbale dalle pagine di istruzioni.</summary>
    private const string InstructionsMarker = "ISTRUZIONI PER LA COMPILAZIONE";

    private static readonly string[] MonthNames =
    [
        "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
    ];

    public WaterSamplingReport Parse(
        string content,
        IReadOnlyDictionary<string, string>? keyValuePairs = null)
    {
        var hasContent = !string.IsNullOrWhiteSpace(content);
        if (!hasContent && keyValuePairs is not { Count: > 0 })
        {
            return WaterSamplingReport.Empty;
        }

        var report = hasContent
            ? ParseText(TrimInstructions(content))
            : WaterSamplingReport.Empty;

        // Le coppie etichetta/valore vengono ricomposte in righe "etichetta valore"
        // e analizzate con le stesse regole: stessa validazione, stesso rifiuto
        // dei placeholder. Colmano solo i campi rimasti vuoti.
        if (keyValuePairs is { Count: > 0 })
        {
            var pairsAsText = string.Join(
                '\n', keyValuePairs.Select(pair => $"{pair.Key} {pair.Value}"));
            report = Merge(report, ParseText(pairsAsText));
        }

        if (report.HasAnyValue)
        {
            logger.LogInformation(
                "Verbale acque: estratti corso={CorsoAcqua}, data={Data}, T={Temp}°C, pH={Ph}, O2={O2}mg/l",
                report.CorsoAcqua ?? "-", report.DataPrelievo?.ToString("yyyy-MM-dd") ?? "-",
                report.TemperaturaAcquaCelsius, report.Ph, report.OssigenoDiscioltoMgL);
        }
        else
        {
            logger.LogInformation(
                "Verbale acque: nessun parametro da campo rilevato (modulo non compilato o formato non riconosciuto)");
        }

        return report;
    }

    private static WaterSamplingReport ParseText(string rawBody)
    {
        var body = NormalizeBoxedDigits(rawBody);
        return new WaterSamplingReport(
            CorsoAcqua: ParseCorsoAcqua(body),
            DataPrelievo: ParseDataPrelievo(body),
            TemperaturaAcquaCelsius: ParseMeasure(TemperaturaAcquaRegex(), body, -5m, 60m),
            Ph: ParseMeasure(PhRegex(), body, 0m, 14m),
            OssigenoDiscioltoMgL: ParseMeasure(OssigenoDiscioltoRegex(), body, 0m, 30m));
    }

    /// <summary>
    /// Il modulo prevede una casella per cifra, e l'OCR le restituisce come
    /// <c>|2| |0|, |5|</c> (a volte con spazi interni: <c>| 8|</c>). Le sequenze
    /// di caselle vengono ricomposte nel numero che rappresentano — <c>20,5</c> —
    /// così le regole di estrazione lavorano su valori contigui.
    /// Le caselle del modulo vuoto (<c>|__|</c>) non contengono cifre e restano
    /// intatte, quindi continuano a non produrre alcun valore.
    /// </summary>
    private static string NormalizeBoxedDigits(string text) =>
        BoxedDigitsRegex().Replace(text, match => new string(
            match.Value.Where(c => char.IsDigit(c) || c == ',').ToArray()));

    /// <summary>Il risultato primario vince; il secondario riempie solo i buchi.</summary>
    private static WaterSamplingReport Merge(
        WaterSamplingReport primary,
        WaterSamplingReport fallback) => new(
        CorsoAcqua: primary.CorsoAcqua ?? fallback.CorsoAcqua,
        DataPrelievo: primary.DataPrelievo ?? fallback.DataPrelievo,
        TemperaturaAcquaCelsius:
            primary.TemperaturaAcquaCelsius ?? fallback.TemperaturaAcquaCelsius,
        Ph: primary.Ph ?? fallback.Ph,
        OssigenoDiscioltoMgL:
            primary.OssigenoDiscioltoMgL ?? fallback.OssigenoDiscioltoMgL);

    /// <summary>Scarta le pagine di istruzioni, che contengono valori di esempio.</summary>
    private static string TrimInstructions(string content)
    {
        var index = content.IndexOf(InstructionsMarker, StringComparison.OrdinalIgnoreCase);
        return index > 0 ? content[..index] : content;
    }

    private static string? ParseCorsoAcqua(string content)
    {
        // Nei moduli reali la denominazione prosegue sulla riga successiva
        // ("Torrente" / "Polcevera"): si legge fino alla prossima etichetta.
        var multiline = CorsoAcquaMultilineRegex().Match(content);
        if (multiline.Success
            && CleanTextValue(multiline.Groups["v"].Value) is { } value)
        {
            return value;
        }

        var match = CorsoAcquaRegex().Match(content);
        return match.Success ? CleanTextValue(match.Groups["v"].Value) : null;
    }

    /// <summary>
    /// Rimuove i placeholder del modulo vuoto. Restituisce null se, tolti
    /// underscore e caselle, non resta alcun contenuto reale.
    /// </summary>
    private static string? CleanTextValue(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var cleaned = PlaceholderRegex().Replace(raw, " ");
        cleaned = WhitespaceRegex().Replace(cleaned, " ").Trim(' ', '.', ':', '-', '_', '|', '❒');

        // Un residuo di un solo carattere è rumore OCR, non una denominazione.
        return cleaned.Length > 1 ? cleaned : null;
    }

    /// <summary>Estrae una misura numerica validandone la plausibilità fisica.</summary>
    private static decimal? ParseMeasure(Regex regex, string content, decimal min, decimal max)
    {
        var match = regex.Match(content);
        if (!match.Success)
        {
            return null;
        }

        // Il verbale usa la virgola decimale italiana.
        var raw = match.Groups["v"].Value.Replace(',', '.');
        if (!decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var value))
        {
            return null;
        }

        // Fuori intervallo = quasi certamente un falso positivo dell'OCR.
        return value >= min && value <= max ? value : null;
    }

    private static DateOnly? ParseDataPrelievo(string content)
    {
        // Forma nativa del modulo: ANNO ____ MESE ____ GIORNO ____
        var structured = AnnoMeseGiornoRegex().Match(content);
        if (structured.Success)
        {
            var month = ParseMonth(structured.Groups["m"].Value);
            if (month is not null
                && int.TryParse(structured.Groups["y"].Value, out var year)
                && int.TryParse(structured.Groups["d"].Value, out var day)
                && TryBuildDate(year, month.Value, day, out var structuredDate))
            {
                return structuredDate;
            }
        }

        // Fallback: data in forma gg/mm/aaaa, ma solo sulle righe che parlano di
        // prelievo. Evita di catturare il "rev00 del 10/11/2022" del piè di pagina.
        foreach (var line in content.Split('\n'))
        {
            if (!SamplingContextRegex().IsMatch(line) || RevisionFooterRegex().IsMatch(line))
            {
                continue;
            }

            var match = NumericDateRegex().Match(line);
            if (match.Success
                && int.TryParse(match.Groups["d"].Value, out var day)
                && int.TryParse(match.Groups["m"].Value, out var month)
                && int.TryParse(match.Groups["y"].Value, out var year)
                && TryBuildDate(year, month, day, out var date))
            {
                return date;
            }
        }

        return null;
    }

    private static int? ParseMonth(string token)
    {
        if (int.TryParse(token, out var numeric))
        {
            return numeric is >= 1 and <= 12 ? numeric : null;
        }

        if (token.Length < 3)
        {
            return null;
        }

        var index = Array.FindIndex(
            MonthNames,
            name => name.StartsWith(token[..3], StringComparison.OrdinalIgnoreCase));
        return index >= 0 ? index + 1 : null;
    }

    private static bool TryBuildDate(int year, int month, int day, out DateOnly date)
    {
        date = default;

        // Anno a due cifre come nella sigla verbale (aa/mm/gg).
        if (year < 100)
        {
            year += 2000;
        }

        if (year is < 1900 or > 2200 || month is < 1 or > 12
            || day < 1 || day > DateTime.DaysInMonth(year, month))
        {
            return false;
        }

        date = new DateOnly(year, month, day);
        return true;
    }

    // "Corso d'acqua <nome>" con valore che può proseguire a capo: si legge
    // fino alla prossima etichetta del modulo, entro un limite prudenziale.
    [GeneratedRegex(
        @"Corso\s*d\s*['’`]\s*acqua\s*[:\-]?\s*(?<v>[\s\S]{0,120}?)\s*(?=Località|Localita|Comune|Provincia|Rif\.|Matrice|Stazione)",
        RegexOptions.IgnoreCase)]
    private static partial Regex CorsoAcquaMultilineRegex();

    // Ripiego su singola riga, quando nessuna etichetta segue il valore.
    [GeneratedRegex(
        @"Corso\s*d\s*['’`]\s*acqua\s*[:\-]?\s*(?<v>[^\r\n]*?)\s*(?=Località|Localita|Comune|Provincia|Stazione|$)",
        RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex CorsoAcquaRegex();

    // Solo "Temperatura acqua": esclude "Temperatura aria" e "Temperatura sonda".
    // L'unità può essere "°C" oppure il carattere unico "℃" (U+2103) usato dall'OCR.
    [GeneratedRegex(
        @"Temperatura\s+(?:dell\s*['’]\s*)?acqua\s*[:\-]?\s*(?<v>\d{1,3}(?:[.,]\d{1,2})?)\s*(?:°\s*C|℃|C)",
        RegexOptions.IgnoreCase)]
    private static partial Regex TemperaturaAcquaRegex();

    // "pH" non preceduto da lettere (evita "pHmetro" e simili).
    [GeneratedRegex(
        @"(?<!\p{L})pH\s*[:\-]?\s*(?<v>\d{1,2}(?:[.,]\d{1,2})?)",
        RegexOptions.IgnoreCase)]
    private static partial Regex PhRegex();

    // Concentrazione in mg/l: l'ancora sull'unità esclude la % di saturazione.
    [GeneratedRegex(
        @"Ossigeno\s+disciolto\s*[:\-]?\s*(?<v>\d{1,3}(?:[.,]\d{1,2})?)\s*mg\s*/\s*l",
        RegexOptions.IgnoreCase)]
    private static partial Regex OssigenoDiscioltoRegex();

    [GeneratedRegex(
        @"ANNO[\s_:\-]*(?<y>\d{2,4})[\s_]*MESE[\s_:\-]*(?<m>\p{L}+|\d{1,2})[\s_]*GIORNO[\s_:\-]*(?<d>\d{1,2})",
        RegexOptions.IgnoreCase)]
    private static partial Regex AnnoMeseGiornoRegex();

    [GeneratedRegex(@"(?<d>\d{1,2})\s*[\/\-.]\s*(?<m>\d{1,2})\s*[\/\-.]\s*(?<y>\d{2,4})")]
    private static partial Regex NumericDateRegex();

    [GeneratedRegex(@"prelievo|sopralluogo|campionamento|\bdata\b", RegexOptions.IgnoreCase)]
    private static partial Regex SamplingContextRegex();

    [GeneratedRegex(@"\brev\s*\d", RegexOptions.IgnoreCase)]
    private static partial Regex RevisionFooterRegex();

    // Sequenze di caselle una-cifra-ciascuna: |2| |0|, |5|  →  20,5
    [GeneratedRegex(@"(?:\|\s*\d\s*\|\s*)+(?:,\s*(?:\|\s*\d\s*\|\s*)+)?")]
    private static partial Regex BoxedDigitsRegex();

    // Placeholder del modulo vuoto: |__|, ____, punti di guida.
    [GeneratedRegex(@"\|_*\||_{2,}|\.{3,}")]
    private static partial Regex PlaceholderRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
