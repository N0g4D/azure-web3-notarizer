namespace Ancorhash.Core.Exceptions;

/// <summary>Richiesta di notarizzazione non valida (mappata su HTTP 400 dal layer API).</summary>
public sealed class NotarizationValidationException(string message) : Exception(message);
