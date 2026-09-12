namespace Ancorhash.Core.Exceptions;

/// <summary>
/// La scrittura dell'entità Arkiv è fallita. Precede il broadcast on-chain:
/// se scatta, nessun gas è stato speso.
/// </summary>
public sealed class ArkivIndexingException : Exception
{
    /// <summary>Codice macchina restituito dal writer Node (es. missing_key, secret_leak_blocked).</summary>
    public string Code { get; }

    public ArkivIndexingException(string code, string message, Exception? innerException = null)
        : base(message, innerException) => Code = code;
}
