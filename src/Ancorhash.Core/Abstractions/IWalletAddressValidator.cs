namespace Ancorhash.Core.Abstractions;

/// <summary>
/// Validazione EIP-55 di un indirizzo Ethereum. Astratta perché il calcolo
/// del checksum (Keccak-256) vive in Infrastructure, non nel dominio.
/// </summary>
public interface IWalletAddressValidator
{
    /// <summary>
    /// True se l'indirizzo è nel formato 0x + 40 hex e il checksum EIP-55
    /// è corretto. Gli indirizzi tutti-minuscoli sono rifiutati: il chiamante
    /// deve fornire l'indirizzo già checksummato.
    /// </summary>
    bool IsValidChecksummedAddress(string address);
}
