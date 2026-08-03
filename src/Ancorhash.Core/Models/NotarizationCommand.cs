namespace Ancorhash.Core.Models;

/// <summary>
/// Comando di notarizzazione ricevuto dal layer API.
/// Zero Data Leakage: il documento non transita mai dal backend,
/// arriva solo l'hash SHA-256 già calcolato lato client.
/// </summary>
/// <param name="DocumentId">Identificativo univoco del documento (dalla Power App).</param>
/// <param name="DocumentHash">SHA-256 hex di 64 caratteri, senza prefisso 0x.</param>
/// <param name="WalletAddress">Indirizzo Ethereum destinatario (EIP-55).</param>
/// <param name="ChainId">Chain ID EIP-155 della rete EVM di destinazione (es. 137, 80002, 11155111).</param>
public sealed record NotarizationCommand(
    string DocumentId,
    string DocumentHash,
    string WalletAddress,
    int ChainId);
