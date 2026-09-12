namespace Ancorhash.Core.Exceptions;

/// <summary>
/// Il documento è già notarizzato on-chain. Non è un guasto: è la regola
/// d'asset del contratto che funziona. tokenId == uint256(documentHash),
/// quindi un secondo mint dello stesso hash rientra sempre.
/// </summary>
public sealed class DuplicateNotarizationException(string documentHash, Exception? innerException = null)
    : Exception(
        $"Il documento {documentHash} è già stato notarizzato: esiste già un token con questo hash.",
        innerException)
{
    /// <summary>Hash del documento già notarizzato.</summary>
    public string DocumentHash { get; } = documentHash;
}
