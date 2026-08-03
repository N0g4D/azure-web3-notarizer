using Ancorhash.Core.Abstractions;
using Nethereum.Util;

namespace Ancorhash.Infrastructure.Blockchain;

/// <summary>Validazione EIP-55 via Nethereum (Keccak-256 checksum).</summary>
public sealed class NethereumWalletAddressValidator : IWalletAddressValidator
{
    public bool IsValidChecksummedAddress(string address) =>
        !string.IsNullOrWhiteSpace(address)
        && AddressUtil.Current.IsValidEthereumAddressHexFormat(address)
        && AddressUtil.Current.IsChecksumAddress(address);
}
