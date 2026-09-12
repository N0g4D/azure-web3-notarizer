using System.Text.RegularExpressions;
using Ancorhash.Core.Abstractions;
using Ancorhash.Core.Exceptions;
using Ancorhash.Core.Models;
using Microsoft.Extensions.Logging;

namespace Ancorhash.Core.Services;

/// <summary>
/// Orchestrazione della notarizzazione: validazione strict del comando
/// (nessun dato sporco raggiunge la blockchain) e delega al relayer.
/// </summary>
public sealed partial class NotarizationService(
    IBlockchainRelayer blockchainRelayer,
    IWalletAddressValidator walletAddressValidator,
    IArkivIndexer arkivIndexer,
    ILogger<NotarizationService> logger) : INotarizationService
{
    public async Task<NotarizationResult> NotarizeAsync(
        NotarizationCommand command,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(command.DocumentId))
        {
            throw new NotarizationValidationException("document_id è obbligatorio.");
        }

        if (string.IsNullOrWhiteSpace(command.DocumentHash)
            || !Sha256HexRegex().IsMatch(command.DocumentHash))
        {
            throw new NotarizationValidationException(
                "document_hash deve essere un hash SHA-256 hex di 64 caratteri, senza prefisso 0x.");
        }

        if (string.IsNullOrWhiteSpace(command.WalletAddress)
            || !walletAddressValidator.IsValidChecksummedAddress(command.WalletAddress))
        {
            throw new NotarizationValidationException(
                "wallet_address non è un indirizzo Ethereum valido con checksum EIP-55.");
        }

        if (command.ChainId <= 0)
        {
            throw new NotarizationValidationException(
                "chain_id è obbligatorio e deve essere un intero positivo (EIP-155).");
        }

        // Difesa in profondità sull'invariante Zero Data Leakage.
        // Una reference Swarm cifrata è di 128 hex: 32 byte di indirizzo più
        // 32 byte di CHIAVE DI DECIFRATURA. Se ne arriva una di 128 qui,
        // il frontend ha smesso di chiamare toPublicAddress() e sta per
        // pubblicare la chiave. Meglio un 400 rumoroso che un documento
        // decifrabile da chiunque su un indice pubblico e permanente.
        if (Hex128Regex().IsMatch(command.SwarmReference))
        {
            logger.LogError(
                "Notarize BLOCCATA per documento {DocumentId}: ricevuta una reference Swarm "
                + "di 128 hex, che include la chiave di decifratura. Il client deve inviare "
                + "solo l'indirizzo pubblico di 64 hex.",
                command.DocumentId);
            throw new NotarizationValidationException(
                "swarm_reference contiene 128 caratteri: è la reference completa e include "
                + "la chiave di decifratura. Inviare solo l'indirizzo pubblico di 64 hex.");
        }

        if (string.IsNullOrWhiteSpace(command.SwarmReference)
            || !Hex64Regex().IsMatch(command.SwarmReference))
        {
            throw new NotarizationValidationException(
                "swarm_reference deve essere l'indirizzo pubblico Swarm: 64 caratteri hex, "
                + "senza prefisso 0x.");
        }

        if (command.ExpirationSeconds < MinExpirationSeconds
            || command.ExpirationSeconds > MaxExpirationSeconds)
        {
            throw new NotarizationValidationException(
                $"expiration_seconds deve essere compreso fra {MinExpirationSeconds} e "
                + $"{MaxExpirationSeconds} secondi (da 1 minuto a 3650 giorni).");
        }

        // Hash normalizzato lowercase: stesso documento → stesso payload on-chain, sempre.
        var normalizedHash = command.DocumentHash.ToLowerInvariant();

        logger.LogInformation(
            "Notarize: avvio per documento {DocumentId} su chain {ChainId}",
            command.DocumentId, command.ChainId);

        // L'ancora RWA viene PRIMA dell'indicizzazione: il token on-chain è la
        // fonte di verità, e solo dopo il broadcast esiste un tx_hash da
        // mettere nel payload dell'entità Arkiv (schema.md §3).
        var transactionHash = await blockchainRelayer
            .SendNotarizationAsync(
                command.ChainId, command.WalletAddress, normalizedHash, cancellationToken)
            .ConfigureAwait(false);

        logger.LogInformation(
            "Notarize: ancora on-chain confermata per documento {DocumentId} su chain "
            + "{ChainId}, tx {TransactionHash}",
            command.DocumentId, command.ChainId, transactionHash);

        // Conseguenza dell'inversione: qui il gas è GIÀ speso e l'ancora esiste.
        // Se l'indicizzazione fallisce, la notarizzazione NON è fallita: sarebbe
        // disonesto restituire un errore a chi ha già pagato e ha una prova
        // valida on-chain. Si restituisce il successo con arkiv_indexed=false,
        // e l'entità potrà essere riscritta senza toccare la blockchain.
        try
        {
            var arkivResult = await arkivIndexer
                .IndexAsync(
                    command with { DocumentHash = normalizedHash },
                    transactionHash,
                    cancellationToken)
                .ConfigureAwait(false);

            logger.LogInformation(
                "Notarize: completata per documento {DocumentId}, tx {TransactionHash}, "
                + "entità Arkiv {EntityKey}",
                command.DocumentId, transactionHash, arkivResult.EntityKey);

            return new NotarizationResult(
                command.DocumentId,
                normalizedHash,
                transactionHash,
                command.ChainId,
                arkivResult.EntityKey,
                arkivResult.ExpiresAtBlock,
                ArkivIndexed: true);
        }
        catch (ArkivIndexingException ex)
        {
            logger.LogError(ex,
                "Notarize: ancora on-chain RIUSCITA (tx {TransactionHash}) ma indicizzazione "
                + "Arkiv fallita per documento {DocumentId} (codice {Code}). La notarizzazione "
                + "resta valida: l'indice è ricostruibile, la transazione no.",
                transactionHash, command.DocumentId, ex.Code);

            return new NotarizationResult(
                command.DocumentId,
                normalizedHash,
                transactionHash,
                command.ChainId,
                ArkivEntityKey: string.Empty,
                ArkivExpiresAtBlock: 0,
                ArkivIndexed: false);
        }
    }

    /// <summary>Validità minima: sotto il minuto la scadenza Arkiv rischia di essere già passata all'atterraggio.</summary>
    private const int MinExpirationSeconds = 60;

    /// <summary>3650 giorni, lo stesso tetto imposto dalla UI.</summary>
    private const int MaxExpirationSeconds = 315_360_000;

    [GeneratedRegex("^[0-9a-fA-F]{64}$")]
    private static partial Regex Sha256HexRegex();

    /// <summary>Indirizzo pubblico Swarm: 32 byte, chiave esclusa.</summary>
    [GeneratedRegex("^[0-9a-fA-F]{64}$")]
    private static partial Regex Hex64Regex();

    /// <summary>Reference Swarm completa: indirizzo + chiave. Da rifiutare sempre.</summary>
    [GeneratedRegex("^[0-9a-fA-F]{128}$")]
    private static partial Regex Hex128Regex();
}
