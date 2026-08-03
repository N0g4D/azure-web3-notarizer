using Ancorhash.Core.Models;

namespace Ancorhash.Core.Abstractions;

/// <summary>Caso d'uso di notarizzazione: valida il comando e delega il broadcast on-chain.</summary>
public interface INotarizationService
{
    /// <exception cref="Exceptions.NotarizationValidationException">Comando non valido.</exception>
    /// <exception cref="Exceptions.UnsupportedChainException">Chain id non configurato.</exception>
    /// <exception cref="Exceptions.BlockchainUnavailableException">Nodo RPC non raggiungibile.</exception>
    /// <exception cref="Exceptions.BlockchainTransactionException">Broadcast rifiutato dopo i retry.</exception>
    Task<NotarizationResult> NotarizeAsync(
        NotarizationCommand command,
        CancellationToken cancellationToken = default);
}
