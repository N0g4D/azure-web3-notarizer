using Ancorhash.Core.Models;

namespace Ancorhash.Core.Abstractions;

/// <summary>
/// Scrive l'entità di notarizzazione sull'indice pubblico Arkiv.
/// L'SDK Arkiv non esiste per .NET: l'implementazione è un ponte verso un
/// piccolo processo Node (vedi arkiv/friction.md F-07).
/// </summary>
public interface IArkivIndexer
{
    /// <summary>
    /// Crea l'entità con la scadenza richiesta.
    /// ATTENZIONE: <paramref name="command"/>.SwarmReference deve essere il solo
    /// indirizzo pubblico (64 hex). Le entità Arkiv sono pubbliche: nessun
    /// segreto, nessun dato personale, nessuna chiave di decifratura.
    /// </summary>
    /// <param name="anchorTransactionHash">
    /// Transaction hash dell'ancora RWA già confermata dal relayer. Finisce nel
    /// payload NON indicizzato dell'entità: è un dato di verifica pubblico.
    /// </param>
    Task<ArkivIndexResult> IndexAsync(
        NotarizationCommand command,
        string anchorTransactionHash,
        CancellationToken cancellationToken = default);
}
