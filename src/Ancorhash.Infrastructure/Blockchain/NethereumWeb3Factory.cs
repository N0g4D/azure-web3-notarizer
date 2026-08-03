using System.Collections.Concurrent;
using Ancorhash.Core.Exceptions;
using Ancorhash.Infrastructure.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Nethereum.Web3;
using Nethereum.Web3.Accounts;

namespace Ancorhash.Infrastructure.Blockchain;

/// <summary>
/// Factory singleton con cache per chain id: ogni client Web3 (e il suo pool
/// HTTP) è creato una sola volta e riusato tra le richieste. L'account è
/// istanziato per network con il chain id EIP-155 in firma, così la stessa
/// master key non è soggetta a replay cross-chain.
/// </summary>
public sealed class NethereumWeb3Factory(
    IOptions<BlockchainOptions> options,
    ILogger<NethereumWeb3Factory> logger) : IWeb3Factory
{
    private readonly BlockchainOptions _options = options.Value;
    private readonly ConcurrentDictionary<int, IWeb3> _clients = new();

    public IWeb3 GetWeb3(int chainId)
    {
        if (!_options.Networks.TryGetValue(chainId, out var network))
        {
            throw new UnsupportedChainException(chainId);
        }

        return _clients.GetOrAdd(chainId, id =>
        {
            logger.LogInformation(
                "Inizializzazione client Web3 per chain {ChainId} ({NetworkName})",
                id, network.Name ?? "n/d");
            var account = new Account(_options.RelayerPrivateKey, id);
            return new Web3(account, network.RpcUrl);
        });
    }
}
