using System.Numerics;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Ancorhash.Infrastructure.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Nethereum.Hex.HexTypes;
using Nethereum.JsonRpc.Client;
using Nethereum.RPC.Eth.DTOs;
using Nethereum.Web3;

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
    IPriceOracleService priceOracle,
    IOptions<BlockchainOptions> options,
    ILogger<NethereumBlockchainRelayer> logger) : IBlockchainRelayer
{
    private const int MaxAttempts = 3;
    private static readonly TimeSpan BaseRetryDelay = TimeSpan.FromSeconds(1);

    private readonly BlockchainOptions _options = options.Value;

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

    public async Task<decimal> EstimateFiatCostAsync(
        int chainId,
        CancellationToken cancellationToken = default)
    {
        if (!_options.Networks.TryGetValue(chainId, out var network))
        {
            throw new UnsupportedChainException(chainId);
        }

        logger.LogInformation(
            "Stima costo chain {ChainId}: IsTestnet={IsTestnet}, NativeCoinId={CoinId}",
            chainId, network.IsTestnet, network.NativeCoinId ?? "(null)");

        // Testnet: il gas non ha valore reale → notarizzazione gratuita.
        if (network.IsTestnet)
        {
            logger.LogInformation(
                "Stima costo chain {ChainId}: testnet, costo 0 senza chiamate RPC", chainId);
            return 0m;
        }

        var web3 = web3Factory.GetWeb3(chainId);
        var relayerAddress = web3.TransactionManager.Account.Address;

        // Transazione rappresentativa: 0 value + 32 byte di hash nel campo data.
        var probe = new TransactionInput
        {
            From = relayerAddress,
            To = relayerAddress,
            Value = new HexBigInteger(BigInteger.Zero),
            Data = "0x" + new string('0', 64),
        };

        try
        {
            var gasLimit = await web3.Eth.TransactionManager
                .EstimateGasAsync(probe)
                .ConfigureAwait(false);
            var gasPrice = await web3.Eth.GasPrice
                .SendRequestAsync()
                .ConfigureAwait(false);

            logger.LogInformation(
                "Stima costo chain {ChainId}: gasLimit={GasLimit}, gasPrice={GasPrice} wei",
                chainId, gasLimit.Value, gasPrice.Value);

            // Costo nativo (in ETH/MATIC/…): wei → unità intera (18 decimali).
            var nativeCost = Web3.Convert.FromWei(gasLimit.Value * gasPrice.Value);

            var usdPrice = network.NativeCoinId is { Length: > 0 } coinId
                ? await priceOracle.GetUsdPriceAsync(coinId, cancellationToken).ConfigureAwait(false)
                : null;

            logger.LogInformation(
                "Stima costo chain {ChainId}: costo nativo={NativeCost}, prezzo USD={UsdPrice}",
                chainId, nativeCost, usdPrice?.ToString() ?? "(null)");

            if (usdPrice is null)
            {
                logger.LogWarning(
                    "Stima costo chain {ChainId}: prezzo USD non disponibile (coin {CoinId})",
                    chainId, network.NativeCoinId ?? "n/d");
                return 0m;
            }

            // 8 decimali: su Polygon una notarizzazione costa ~$0.0007, quindi
            // arrotondare al quarto decimale sarebbe già al limite del troncamento a 0.
            var costUsd = decimal.Round(nativeCost * usdPrice.Value, 8, MidpointRounding.AwayFromZero);
            logger.LogInformation(
                "Stima costo chain {ChainId}: {NativeCost} native × {UsdPrice} USD = {CostUsd} USD",
                chainId, nativeCost, usdPrice.Value, costUsd);
            return costUsd;
        }
        catch (Exception ex) when (
            ex is RpcResponseException or RpcClientUnknownException
                or RpcClientTimeoutException or HttpRequestException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            // LogCritical: forzato in output anche con filtri di log restrittivi.
            logger.LogCritical(ex,
                "Stima costo chain {ChainId} fallita: {ExceptionType}", chainId, ex.GetType().Name);
            throw new BlockchainUnavailableException(
                $"Impossibile stimare il costo del gas sulla chain {chainId}.", ex);
        }
    }
}
