using System.Numerics;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Ancorhash.Infrastructure.Blockchain.Contracts;
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
        string swarmAddress,
        CancellationToken cancellationToken = default)
    {
        if (!_options.Networks.TryGetValue(chainId, out var network))
        {
            throw new UnsupportedChainException(chainId);
        }

        var web3 = web3Factory.GetWeb3(chainId);

        // Senza contratto configurato si ricade sul comportamento pre Fase 3:
        // transazione dati a 0 valore. Utile per una rete senza deploy, ma NON
        // soddisfa il Track B di Team1, che pretende un asset tokenizzato.
        if (string.IsNullOrWhiteSpace(network.ContractAddress))
        {
            logger.LogWarning(
                "Chain {ChainId} senza ContractAddress: fallback a transazione dati. "
                + "Nessun token RWA viene emesso.", chainId);
            return await SendRawDataAnchorAsync(
                web3, chainId, walletAddress, documentHash, cancellationToken)
                .ConfigureAwait(false);
        }

        return await MintNotarizationAsync(
            web3, chainId, network.ContractAddress, documentHash, swarmAddress, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Emette il token RWA chiamando mintNotarization(bytes32,bytes32) e
    /// attende la ricevuta: il tx_hash restituito è quello di una transazione
    /// gia' inclusa, non solo accettata in mempool. Serve alla Fase 2, che lo
    /// inietta nel payload dell'entità Arkiv.
    /// </summary>
    private async Task<string> MintNotarizationAsync(
        Nethereum.Web3.IWeb3 web3,
        int chainId,
        string contractAddress,
        string documentHash,
        string swarmAddress,
        CancellationToken cancellationToken)
    {
        var handler = web3.Eth.GetContractTransactionHandler<MintNotarizationFunction>();
        var message = new MintNotarizationFunction
        {
            DocumentHash = HexToBytes32(documentHash, nameof(documentHash)),
            SwarmAddress = HexToBytes32(swarmAddress, nameof(swarmAddress)),
        };

        // Il documento già notarizzato fa rientrare il mint. Intercettarlo qui
        // evita di spendere gas per una transazione destinata a fallire, e
        // produce un 409 invece di un 500 opaco.
        try
        {
            var queryHandler = web3.Eth.GetContractQueryHandler<IsNotarizedFunction>();
            var exists = await queryHandler
                .QueryAsync<bool>(contractAddress, new IsNotarizedFunction
                {
                    DocumentHash = message.DocumentHash,
                })
                .ConfigureAwait(false);
            if (exists) throw new DuplicateNotarizationException(documentHash);
        }
        catch (Exception ex) when (ex is not DuplicateNotarizationException
            && ex is not OperationCanceledException)
        {
            // Una view non raggiungibile non deve bloccare il mint: se il
            // documento esiste davvero, sarà il contratto a rifiutare.
            logger.LogDebug(ex, "isNotarized non interrogabile su chain {ChainId}", chainId);
        }

        for (var attempt = 1; ; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var receipt = await handler
                    .SendRequestAndWaitForReceiptAsync(contractAddress, message)
                    .ConfigureAwait(false);

                if (receipt.Status?.Value == 0)
                {
                    // Inclusa ma fallita: la causa piu' probabile e' la regola
                    // d'asset, cioè un documento gia' notarizzato.
                    throw new DuplicateNotarizationException(documentHash);
                }

                logger.LogInformation(
                    "RWA mintato su chain {ChainId}: tx {TransactionHash}, contratto {Contract}, "
                    + "blocco {Block}, gas {Gas}",
                    chainId, receipt.TransactionHash, contractAddress,
                    receipt.BlockNumber?.Value, receipt.GasUsed?.Value);
                return receipt.TransactionHash;
            }
            catch (Nethereum.JsonRpc.Client.RpcResponseException ex)
                when (IsAlreadyMintedRevert(ex))
            {
                throw new DuplicateNotarizationException(documentHash, ex);
            }
            catch (RpcResponseException ex) when (attempt < MaxAttempts)
            {
                var delay = BaseRetryDelay * Math.Pow(2, attempt - 1);
                logger.LogWarning(
                    "Mint rifiutato dal nodo RPC su chain {ChainId} (tentativo {Attempt}/{MaxAttempts}), retry tra {DelaySeconds}s: {RpcError}",
                    chainId, attempt, MaxAttempts, delay.TotalSeconds, ex.RpcError?.Message ?? ex.Message);
                await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
            }
            catch (RpcResponseException ex)
            {
                throw new BlockchainTransactionException(
                    $"Mint rifiutato dal nodo RPC (chain {chainId}) dopo {MaxAttempts} tentativi: {ex.RpcError?.Message ?? ex.Message}",
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

    /// <summary>Fallback pre Fase 3: transazione dati a 0 valore, nessun token.</summary>
    private async Task<string> SendRawDataAnchorAsync(
        Nethereum.Web3.IWeb3 web3,
        int chainId,
        string walletAddress,
        string documentHash,
        CancellationToken cancellationToken)
    {
        var transaction = new TransactionInput
        {
            From = web3.TransactionManager.Account.Address,
            To = walletAddress,
            Value = new HexBigInteger(BigInteger.Zero),
            Data = "0x" + documentHash,
        };
        transaction.Gas = await web3.Eth.TransactionManager
            .EstimateGasAsync(transaction).ConfigureAwait(false);

        for (var attempt = 1; ; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var transactionHash = await web3.Eth.TransactionManager
                    .SendTransactionAsync(transaction).ConfigureAwait(false);
                logger.LogInformation(
                    "Ancora dati su chain {ChainId}: {TransactionHash}", chainId, transactionHash);
                return transactionHash;
            }
            catch (RpcResponseException) when (attempt < MaxAttempts)
            {
                var delay = BaseRetryDelay * Math.Pow(2, attempt - 1);
                await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
            }
            catch (RpcResponseException ex)
            {
                throw new BlockchainTransactionException(
                    $"Broadcast rifiutato (chain {chainId}) dopo {MaxAttempts} tentativi: {ex.RpcError?.Message ?? ex.Message}",
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

    /// <summary>
    /// Riconosce il rientro del contratto per token già esistente. OZ v5 usa
    /// l'errore custom ERC721InvalidSender(address(0)) quando _mint trova il
    /// token occupato; selector 0x73c6ac6e.
    /// </summary>
    private static bool IsAlreadyMintedRevert(RpcResponseException ex)
    {
        var text = (ex.RpcError?.Message ?? string.Empty) + (ex.RpcError?.Data?.ToString() ?? string.Empty);
        return text.Contains("0x73c6ac6e", StringComparison.OrdinalIgnoreCase)
            || text.Contains("ERC721InvalidSender", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>64 hex senza 0x -> 32 byte, come pretende un parametro bytes32.</summary>
    private static byte[] HexToBytes32(string hex, string parameterName)
    {
        var clean = hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? hex[2..] : hex;
        if (clean.Length != 64)
        {
            throw new ArgumentException(
                $"{parameterName} deve essere di 64 caratteri hex (32 byte), ricevuti {clean.Length}.",
                parameterName);
        }
        return Convert.FromHexString(clean);
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
