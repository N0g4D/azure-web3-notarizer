using System.Numerics;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Microsoft.Extensions.Logging;
using Nethereum.Hex.HexTypes;
using Nethereum.JsonRpc.Client;
using Nethereum.RPC.Eth.DTOs;

namespace Ancorhash.Infrastructure.Blockchain;

/// <summary>
/// Relayer EVM-agnostic: transazione EIP-1559 a 0 ETH con l'hash del documento
/// nel campo data, firmata con la master key del relayer (gas a carico della
/// piattaforma) sulla rete selezionata dal chain id. Nonce, stima gas e fee
/// 1559 sono gestiti dal TransactionManager di Nethereum; il client Web3 per
/// network arriva dalla factory (cache singleton).
/// </summary>
public sealed class NethereumBlockchainRelayer(
    IWeb3Factory web3Factory,
    ILogger<NethereumBlockchainRelayer> logger) : IBlockchainRelayer
{
    private const int MaxAttempts = 3;
    private static readonly TimeSpan BaseRetryDelay = TimeSpan.FromSeconds(1);

    public async Task<string> SendNotarizationAsync(
        int chainId,
        string walletAddress,
        string documentHash,
        CancellationToken cancellationToken = default)
    {
        var web3 = web3Factory.GetWeb3(chainId);

        var transaction = new TransactionInput
        {
            From = web3.TransactionManager.Account.Address,
            To = walletAddress,
            Value = new HexBigInteger(BigInteger.Zero),
            Data = "0x" + documentHash,
        };

        // fix: Chiediamo al nodo di stimare il gas esatto (che sarà ~21512)
        var estimatedGas = await web3.Eth.TransactionManager.EstimateGasAsync(transaction);
        transaction.Gas = estimatedGas;

        for (var attempt = 1; ; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var transactionHash = await web3.Eth.TransactionManager
                    .SendTransactionAsync(transaction)
                    .ConfigureAwait(false);

                logger.LogInformation(
                    "Transazione broadcasted su chain {ChainId}: {TransactionHash} verso {WalletAddress}",
                    chainId, transactionHash, walletAddress);
                return transactionHash;
            }
            catch (RpcResponseException ex) when (attempt < MaxAttempts)
            {
                // Errori applicativi del nodo (es. nonce too low): retry con backoff esponenziale.
                var delay = BaseRetryDelay * Math.Pow(2, attempt - 1);
                logger.LogWarning(
                    "Broadcast rifiutato dal nodo RPC su chain {ChainId} (tentativo {Attempt}/{MaxAttempts}), retry tra {DelaySeconds}s: {RpcError}",
                    chainId, attempt, MaxAttempts, delay.TotalSeconds, ex.RpcError?.Message ?? ex.Message);
                await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
            }
            catch (RpcResponseException ex)
            {
                throw new BlockchainTransactionException(
                    $"Broadcast rifiutato dal nodo RPC (chain {chainId}) dopo {MaxAttempts} tentativi: {ex.RpcError?.Message ?? ex.Message}",
                    ex);
            }
            catch (Exception ex) when (
                ex is RpcClientUnknownException or RpcClientTimeoutException or HttpRequestException
                || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
            {
                throw new BlockchainUnavailableException(
                    $"Impossibile comunicare con il nodo RPC della chain {chainId}.", ex);
            }
        }
    }
}
