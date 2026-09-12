using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Ancorhash.Core.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ancorhash.Infrastructure.Arkiv;

/// <summary>
/// Ponte verso il writer Node di Arkiv. L'SDK Arkiv è solo TypeScript, quindi
/// la scrittura dell'entità gira in un processo figlio a vita breve
/// (arkiv/friction.md F-07).
///
/// Il payload viaggia su STDIN e non su argv: gli argomenti di un processo
/// sono visibili a chiunque possa leggere la process list.
/// La chiave privata viaggia nell'ambiente del figlio e non è mai loggata.
/// </summary>
public sealed class NodeArkivIndexer(
    IOptions<Configuration.ArkivOptions> options,
    IOptions<Configuration.BlockchainOptions> blockchainOptions,
    ILogger<NodeArkivIndexer> logger) : IArkivIndexer
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly Configuration.ArkivOptions _options = options.Value;
    private readonly Configuration.BlockchainOptions _blockchain = blockchainOptions.Value;

    public async Task<ArkivIndexResult> IndexAsync(
        NotarizationCommand command,
        string anchorTransactionHash,
        CancellationToken cancellationToken = default)
    {
        var scriptPath = Path.GetFullPath(_options.ScriptPath);
        if (!File.Exists(scriptPath))
        {
            throw new ArkivIndexingException(
                "writer_not_found",
                $"Writer Arkiv non trovato in {scriptPath}. Verificare Arkiv:ScriptPath.");
        }

        if (string.IsNullOrWhiteSpace(_options.PrivateKey))
        {
            throw new ArkivIndexingException(
                "missing_key",
                "Arkiv:PrivateKey non configurata. In locale usare una variabile d'ambiente, "
                + "in cloud Key Vault. Mai nel codice.");
        }

        // Nome ed explorer della chain di ancoraggio: dati pubblici di
        // presentazione, destinati al payload NON indicizzato dell'entità.
        _blockchain.Networks.TryGetValue(command.ChainId, out var network);
        var explorerUrl = network?.ExplorerTxUrl is { Length: > 0 } prefix
            ? prefix + anchorTransactionHash
            : null;

        var input = JsonSerializer.Serialize(
            new ArkivWriterInput
            {
                DocumentId = command.DocumentId,
                DocumentHash = command.DocumentHash,
                // Solo l'indirizzo pubblico: 64 hex, chiave esclusa.
                SwarmAddress = command.SwarmReference,
                ExpirationSeconds = command.ExpirationSeconds,
                ChainId = command.ChainId,
                TxHash = anchorTransactionHash,
                AnchorChain = network?.Name,
                ExplorerUrl = explorerUrl,
            },
            JsonOptions);

        var startInfo = new ProcessStartInfo
        {
            FileName = _options.NodeExecutable,
            WorkingDirectory = Path.GetDirectoryName(scriptPath)!,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.Environment["ARKIV_PRIVATE_KEY"] = _options.PrivateKey;
        if (!string.IsNullOrWhiteSpace(_options.RpcUrl))
        {
            startInfo.Environment["ARKIV_RPC_URL"] = _options.RpcUrl;
        }

        using var process = new Process { StartInfo = startInfo };

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            throw new ArkivIndexingException(
                "node_not_available",
                $"Impossibile avviare '{_options.NodeExecutable}'. Node 18+ è richiesto per il "
                + "ponte Arkiv.", ex);
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

        string stdout;
        string stderr;
        try
        {
            await process.StandardInput.WriteAsync(input.AsMemory(), timeoutCts.Token)
                .ConfigureAwait(false);
            process.StandardInput.Close();

            var stdoutTask = process.StandardOutput.ReadToEndAsync(timeoutCts.Token);
            var stderrTask = process.StandardError.ReadToEndAsync(timeoutCts.Token);
            await process.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
            stdout = await stdoutTask.ConfigureAwait(false);
            stderr = await stderrTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            TryKill(process);
            throw new ArkivIndexingException(
                "timeout",
                $"Il writer Arkiv non ha risposto entro {_options.TimeoutSeconds}s.");
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            throw;
        }

        if (!string.IsNullOrWhiteSpace(stderr))
        {
            // Node scrive qui i warning (es. localStorage): utile ma non fatale.
            logger.LogDebug("Writer Arkiv, stderr: {Stderr}", stderr.Trim());
        }

        ArkivWriterOutput? output;
        try
        {
            output = JsonSerializer.Deserialize<ArkivWriterOutput>(stdout, JsonOptions);
        }
        catch (JsonException ex)
        {
            throw new ArkivIndexingException(
                "invalid_writer_output",
                $"Output del writer Arkiv non interpretabile (exit {process.ExitCode}).", ex);
        }

        if (output is null)
        {
            throw new ArkivIndexingException(
                "empty_writer_output",
                $"Il writer Arkiv non ha prodotto output (exit {process.ExitCode}).");
        }

        if (!output.Ok)
        {
            throw new ArkivIndexingException(
                output.Code ?? "arkiv_write_failed",
                output.Error ?? "Scrittura su Arkiv fallita senza dettagli.");
        }

        if (string.IsNullOrWhiteSpace(output.EntityKey)
            || !ulong.TryParse(output.ExpiresAtBlock, out var expiresAtBlock))
        {
            throw new ArkivIndexingException(
                "incomplete_writer_output",
                "Il writer Arkiv ha risposto ok ma senza entity_key o expires_at_block validi.");
        }

        logger.LogInformation(
            "Arkiv: entità {EntityKey} creata per documento {DocumentId}, scade al blocco "
            + "{ExpiresAtBlock} ({LifetimeBlocks} blocchi)",
            output.EntityKey, command.DocumentId, expiresAtBlock, output.LifetimeBlocks);

        return new ArkivIndexResult(
            output.EntityKey,
            output.TxHash ?? string.Empty,
            expiresAtBlock,
            output.LifetimeBlocks);
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Il processo è già morto: non c'è nulla da recuperare.
        }
    }

    /// <summary>Contratto STDIN del writer. Nessun campo segreto.</summary>
    private sealed record ArkivWriterInput
    {
        public required string DocumentId { get; init; }
        public required string DocumentHash { get; init; }
        public required string SwarmAddress { get; init; }
        public required int ExpirationSeconds { get; init; }
        public required int ChainId { get; init; }

        /// <summary>Hash dell'ancora RWA. Verifica pubblica, non un segreto.</summary>
        public string? TxHash { get; init; }
        public string? AnchorChain { get; init; }
        public string? ExplorerUrl { get; init; }
    }

    /// <summary>Contratto STDOUT del writer.</summary>
    private sealed record ArkivWriterOutput
    {
        public bool Ok { get; init; }
        public string? EntityKey { get; init; }
        public string? TxHash { get; init; }
        /// <summary>Stringa: un blocco è un uint64 e non entra sempre in un long JSON.</summary>
        public string? ExpiresAtBlock { get; init; }
        public int LifetimeBlocks { get; init; }
        public string? Code { get; init; }
        public string? Error { get; init; }
    }
}
