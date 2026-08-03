namespace Ancorhash.Core.Exceptions;

/// <summary>
/// Il chain_id richiesto non è presente nella configurazione dei network
/// supportati (mappata su HTTP 400 dal layer API).
/// </summary>
public sealed class UnsupportedChainException(int chainId)
    : Exception($"La rete EVM con chain_id {chainId} non è supportata.")
{
    public int ChainId { get; } = chainId;
}
