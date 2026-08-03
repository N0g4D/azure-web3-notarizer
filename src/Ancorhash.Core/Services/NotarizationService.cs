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

        // Hash normalizzato lowercase: stesso documento → stesso payload on-chain, sempre.
        var normalizedHash = command.DocumentHash.ToLowerInvariant();

        logger.LogInformation(
            "Notarize: avvio per documento {DocumentId} su chain {ChainId}",
            command.DocumentId, command.ChainId);

        var transactionHash = await blockchainRelayer
            .SendNotarizationAsync(
                command.ChainId, command.WalletAddress, normalizedHash, cancellationToken)
            .ConfigureAwait(false);

        logger.LogInformation(
            "Notarize: completata per documento {DocumentId} su chain {ChainId}, tx {TransactionHash}",
            command.DocumentId, command.ChainId, transactionHash);

        return new NotarizationResult(
            command.DocumentId, normalizedHash, transactionHash, command.ChainId);
    }

    [GeneratedRegex("^[0-9a-fA-F]{64}$")]
    private static partial Regex Sha256HexRegex();
}
