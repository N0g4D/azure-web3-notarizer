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
/// <param name="SwarmReference">
/// Indirizzo pubblico Swarm del documento cifrato: 64 hex, SENZA la chiave di
/// decifratura. La reference completa (128 hex) non deve mai arrivare qui.
/// </param>
/// <param name="ExpirationSeconds">Validità del record in secondi; su Arkiv diventa una scadenza in blocchi.</param>
public sealed record NotarizationCommand(
    string DocumentId,
    string DocumentHash,
    string WalletAddress,
    int ChainId,
    string SwarmReference,
    int ExpirationSeconds);
