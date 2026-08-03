namespace Ancorhash.Core.Exceptions;

/// <summary>Quota o rate limit del servizio AI superato (mappata su HTTP 429).</summary>
public sealed class DocumentExtractionThrottledException(string message, Exception? innerException = null)
    : Exception(message, innerException);
