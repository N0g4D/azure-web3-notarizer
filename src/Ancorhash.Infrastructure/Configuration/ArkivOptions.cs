using System.ComponentModel.DataAnnotations;

namespace Ancorhash.Infrastructure.Configuration;

/// <summary>Configurazione del ponte verso il writer Node di Arkiv.</summary>
public sealed class ArkivOptions
{
    public const string SectionName = "Arkiv";

    /// <summary>Chiave di configurazione della chiave privata (Key Vault in cloud, env in locale).</summary>
    public const string PrivateKeyConfigKey = "Arkiv:PrivateKey";

    /// <summary>Se false, la notarizzazione procede senza indicizzare su Arkiv.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Eseguibile Node.</summary>
    [Required]
    public string NodeExecutable { get; set; } = "node";

    /// <summary>Percorso dello script writer, assoluto o relativo alla working directory del processo.</summary>
    [Required]
    public string ScriptPath { get; set; } =
        "../Ancorhash.Infrastructure/ArkivWriter/src/write-entity.mjs";

    /// <summary>Timeout della scrittura. Include il tempo di inclusione della transazione.</summary>
    [Range(5, 300)]
    public int TimeoutSeconds { get; set; } = 90;

    /// <summary>RPC Tiramisu. Vuoto = endpoint pubblico di default, rate-limited.</summary>
    public string RpcUrl { get; set; } = string.Empty;

    /// <summary>Chiave privata del wallet che firma le entità. Mai loggata, mai serializzata.</summary>
    public string PrivateKey { get; set; } = string.Empty;
}
