using Ancorhash.Core.Abstractions;
using Ancorhash.Infrastructure.Blockchain;
using Ancorhash.Infrastructure.Configuration;
using Ancorhash.Infrastructure.DocumentIntelligence;
using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Ancorhash.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Registra le implementazioni Infrastructure (Nethereum, Azure AI) e le
    /// configurazioni con validazione fail-fast all'avvio.
    /// La master key del relayer è letta da Evm:RelayerPrivateKey
    /// (Key Vault in cloud, variabile d'ambiente in locale).
    /// </summary>
    public static IServiceCollection AddAncorhashInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Credenziale unica per tutti i servizi Azure (Managed Identity in cloud).
        services.TryAddSingleton<TokenCredential>(_ => new DefaultAzureCredential());

        services.AddOptions<BlockchainOptions>()
            .Bind(configuration.GetSection(BlockchainOptions.SectionName))
            .PostConfigure(options => options.RelayerPrivateKey =
                configuration[BlockchainOptions.RelayerPrivateKeyConfigKey] ?? string.Empty)
            .ValidateDataAnnotations()
            .Validate(
                options => options.Networks.Count > 0,
                "Almeno un network EVM deve essere configurato in Blockchain:Networks.")
            .Validate(
                options => options.Networks.Values
                    .All(n => Uri.IsWellFormedUriString(n.RpcUrl, UriKind.Absolute)),
                "Ogni network in Blockchain:Networks deve avere un RpcUrl assoluto valido.")
            .ValidateOnStart();

        services.AddOptions<DocumentIntelligenceOptions>()
            .Bind(configuration.GetSection(DocumentIntelligenceOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services.AddSingleton<IWeb3Factory, NethereumWeb3Factory>();
        services.AddSingleton<IWalletAddressValidator, NethereumWalletAddressValidator>();
        services.AddSingleton<IBlockchainRelayer, NethereumBlockchainRelayer>();
        services.AddSingleton<IDocumentExtractionService, AzureDocumentExtractionService>();
        return services;
    }
}
