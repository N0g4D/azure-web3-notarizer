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
using OpenTelemetry.Logs;

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

// host.json imposta telemetryMode=OpenTelemetry: senza un exporter registrato
// i log entrano nella pipeline OTel e non vengono emessi da nessuna parte
// (nessun output su console durante `func start`). Il console exporter li rende
// visibili in sviluppo; in cloud si riattiva .UseAzureMonitorExporter().
builder.Services.AddOpenTelemetry()
    .UseFunctionsWorkerDefaults()
    .WithLogging(logging => logging.AddConsoleExporter());
    // .UseAzureMonitorExporter();

builder.Services.AddMemoryCache();

builder.Services
    .AddAncorhashCore()
    .AddAncorhashInfrastructure(builder.Configuration);

builder.Build().Run();
