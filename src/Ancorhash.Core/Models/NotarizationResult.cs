namespace Ancorhash.Core.Models;

/// <summary>Esito di una notarizzazione andata a buon fine.</summary>
/// <param name="DocumentId">Identificativo del documento notarizzato.</param>
/// <param name="DocumentHash">Hash SHA-256 normalizzato (lowercase, senza 0x).</param>
/// <param name="TransactionHash">Transaction hash on-chain (con prefisso 0x).</param>
/// <param name="ChainId">Chain ID EIP-155 della rete su cui è avvenuto il broadcast.</param>
public sealed record NotarizationResult(
    string DocumentId,
    string DocumentHash,
    string TransactionHash,
    int ChainId);
