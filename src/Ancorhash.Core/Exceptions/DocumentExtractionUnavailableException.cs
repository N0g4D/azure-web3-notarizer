namespace Ancorhash.Core.Exceptions;

/// <summary>Servizio AI non raggiungibile o in errore non recuperabile (mappata su HTTP 502).</summary>
public sealed class DocumentExtractionUnavailableException(string message, Exception? innerException = null)
    : Exception(message, innerException);
