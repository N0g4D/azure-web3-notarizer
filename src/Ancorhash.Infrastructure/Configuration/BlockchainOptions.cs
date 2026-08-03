using System.ComponentModel.DataAnnotations;

namespace Ancorhash.Infrastructure.Configuration;

/// <summary>Configurazione di un singolo network EVM supportato.</summary>
public sealed class NetworkConfig
{
    /// <summary>Endpoint JSON-RPC del network.</summary>
    public string RpcUrl { get; init; } = string.Empty;

    /// <summary>Nome leggibile del network (solo per logging/diagnostica).</summary>
    public string? Name { get; init; }
}

/// <summary>
/// Configurazione multi-chain del relayer EVM.
/// I network sono bindati dalla sezione "Blockchain:Networks" (chiave = chain id
/// EIP-155); la master key arriva da Azure Key Vault (segreto Evm--RelayerPrivateKey
/// → chiave di configurazione Evm:RelayerPrivateKey) ed è iniettata qui via
/// PostConfigure. Con ValidateOnStart l'app non parte se la configurazione è incompleta.
/// </summary>
public sealed class BlockchainOptions
{
    public const string SectionName = "Blockchain";

    /// <summary>Chiave di configurazione della master key (segreto Key Vault Evm--RelayerPrivateKey).</summary>
    public const string RelayerPrivateKeyConfigKey = "Evm:RelayerPrivateKey";

    /// <summary>Network EVM supportati, indicizzati per chain id EIP-155.</summary>
    public Dictionary<int, NetworkConfig> Networks { get; init; } = [];

    /// <summary>
    /// Master key del wallet relayer, valida su tutti i network EVM.
    /// Popolata da Azure Key Vault (DefaultAzureCredential); in locale può
    /// arrivare dalla variabile d'ambiente Evm__RelayerPrivateKey.
    /// </summary>
    [Required]
    [RegularExpression("^0x[0-9a-fA-F]{64}$",
        ErrorMessage = "RelayerPrivateKey deve essere di 66 caratteri: prefisso 0x + 64 hex digits.")]
    public string RelayerPrivateKey { get; set; } = string.Empty;
}
