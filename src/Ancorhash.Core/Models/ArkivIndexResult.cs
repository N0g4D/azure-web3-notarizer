namespace Ancorhash.Core.Models;

/// <summary>
/// Esito della scrittura dell'entità Arkiv (indice pubblico interrogabile).
/// </summary>
/// <param name="EntityKey">Chiave a 32 byte dell'entità, derivata dal motore.</param>
/// <param name="TransactionHash">Transaction hash della scrittura su Tiramisu.</param>
/// <param name="ExpiresAtBlock">
/// Blocco di scadenza RILETTO dalla ricevuta. Per una durata è un lower bound:
/// il motore la risolve contro il blocco in cui la transazione atterra, non
/// contro quello letto prima di firmare.
/// </param>
/// <param name="LifetimeBlocks">Vita richiesta in blocchi: ceil(expiration_seconds / 2).</param>
public sealed record ArkivIndexResult(
    string EntityKey,
    string TransactionHash,
    ulong ExpiresAtBlock,
    int LifetimeBlocks);
