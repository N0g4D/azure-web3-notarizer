using Ancorhash.Api.Middleware;
using Ancorhash.Core;
using Ancorhash.Infrastructure;
using Azure.Identity;
using Azure.Monitor.OpenTelemetry.Exporter;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Azure.Functions.Worker.OpenTelemetry;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OpenTelemetry;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

// Anti-draining: rate limiting per IP su /notarize, prima di ogni function.
builder.UseMiddleware<RateLimitingMiddleware>();

// Azure Key Vault come configuration provider: il segreto Evm--RelayerPrivateKey
// diventa la chiave Evm:RelayerPrivateKey e popola BlockchainOptions.RelayerPrivateKey.
// In locale (KeyVault:Uri assente) la stessa chiave arriva da Evm__RelayerPrivateKey.
// Auth via DefaultAzureCredential: Managed Identity in cloud, az login in locale.
var keyVaultUri = builder.Configuration["KeyVault:Uri"];
if (!string.IsNullOrWhiteSpace(keyVaultUri))
{
    builder.Configuration.AddAzureKeyVault(
        new Uri(keyVaultUri),
        new DefaultAzureCredential());
}

builder.Services.AddOpenTelemetry()
    .UseFunctionsWorkerDefaults();
    // .UseAzureMonitorExporter();

builder.Services.AddMemoryCache();

builder.Services
    .AddAncorhashCore()
    .AddAncorhashInfrastructure(builder.Configuration);

builder.Build().Run();
