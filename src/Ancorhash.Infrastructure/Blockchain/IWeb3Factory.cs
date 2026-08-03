using Nethereum.Web3;

namespace Ancorhash.Infrastructure.Blockchain;

/// <summary>
/// Factory di client Web3 per network EVM. Contratto interno a Infrastructure:
/// il Core non deve conoscere Nethereum.
/// </summary>
public interface IWeb3Factory
{
    /// <summary>
    /// Restituisce il client Web3 per il chain id richiesto, firmato con la
    /// master key del relayer sull'RPC configurato per quel network.
    /// </summary>
    /// <exception cref="Ancorhash.Core.Exceptions.UnsupportedChainException">
    /// Chain id assente dalla configurazione.
    /// </exception>
    IWeb3 GetWeb3(int chainId);
}
