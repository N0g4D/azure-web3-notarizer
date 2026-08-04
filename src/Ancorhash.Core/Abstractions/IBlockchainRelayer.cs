namespace Ancorhash.Core.Abstractions;

/// <summary>
/// Relayer on-chain EVM-agnostic: la piattaforma paga il gas per conto
/// dell'utente e ancora l'hash del documento nel campo data di una
/// transazione a 0 ETH sulla rete indicata dal chain id.
/// Implementato in Infrastructure (Nethereum).
/// </summary>
public interface IBlockchainRelayer
{
    /// <param name="chainId">Chain ID EIP-155 della rete EVM di destinazione.</param>
    /// <param name="walletAddress">Indirizzo Ethereum destinatario (già validato EIP-55).</param>
    /// <param name="documentHash">SHA-256 hex di 64 caratteri, lowercase, senza 0x.</param>
    /// <returns>Transaction hash (con prefisso 0x).</returns>
    /// <exception cref="Exceptions.UnsupportedChainException">Chain id non configurato.</exception>
    /// <exception cref="Exceptions.BlockchainUnavailableException">Nodo RPC non raggiungibile.</exception>
    /// <exception cref="Exceptions.BlockchainTransactionException">Broadcast rifiutato dopo i retry.</exception>
    Task<string> SendNotarizationAsync(
        int chainId,
        string walletAddress,
        string documentHash,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Stima il costo in USD di una notarizzazione sulla rete indicata:
    /// (gas limit stimato × gas price corrente) convertito in USD tramite
    /// l'oracolo dei prezzi. Per le testnet restituisce 0 (gas senza valore).
    /// </summary>
    /// <param name="chainId">Chain ID EIP-155 della rete EVM.</param>
    /// <returns>Costo stimato in USD (0 per le testnet).</returns>
    /// <exception cref="Exceptions.UnsupportedChainException">Chain id non configurato.</exception>
    /// <exception cref="Exceptions.BlockchainUnavailableException">Nodo RPC non raggiungibile.</exception>
    Task<decimal> EstimateFiatCostAsync(
        int chainId,
        CancellationToken cancellationToken = default);
}
