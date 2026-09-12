using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Contracts;

namespace Ancorhash.Infrastructure.Blockchain.Contracts;

/// <summary>
/// mintNotarization(bytes32 documentHash, bytes32 swarmAddress) -> uint256 tokenId
///
/// Firma verificata sull'ABI prodotto da forge
/// (src/Ancorhash.Contracts/out/ConfidentialRWA.sol/ConfidentialRWA.json).
/// Selector: 0xc7eecb2b.
/// </summary>
[Function("mintNotarization", "uint256")]
public sealed class MintNotarizationFunction : FunctionMessage
{
    /// <summary>SHA-256 del documento, 32 byte.</summary>
    [Parameter("bytes32", "documentHash", 1)]
    public byte[] DocumentHash { get; set; } = [];

    /// <summary>
    /// Indirizzo pubblico Swarm, 32 byte. Mai la reference completa di 64 byte:
    /// la seconda metà è la chiave di decifratura.
    /// </summary>
    [Parameter("bytes32", "swarmAddress", 2)]
    public byte[] SwarmAddress { get; set; } = [];
}

/// <summary>isNotarized(bytes32) -> bool. Sola lettura, nessun gas.</summary>
[Function("isNotarized", "bool")]
public sealed class IsNotarizedFunction : FunctionMessage
{
    [Parameter("bytes32", "documentHash", 1)]
    public byte[] DocumentHash { get; set; } = [];
}
