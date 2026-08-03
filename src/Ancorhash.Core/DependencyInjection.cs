using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Ancorhash.Core;

public static class DependencyInjection
{
    /// <summary>Registra i casi d'uso del dominio (stateless → singleton).</summary>
    public static IServiceCollection AddAncorhashCore(this IServiceCollection services)
    {
        services.AddSingleton<INotarizationService, NotarizationService>();
        return services;
    }
}
