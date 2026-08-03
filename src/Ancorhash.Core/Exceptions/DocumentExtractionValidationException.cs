namespace Ancorhash.Core.Exceptions;

/// <summary>Documento non processabile: vuoto, formato non supportato o senza contenuto estraibile (mappata su HTTP 400).</summary>
public sealed class DocumentExtractionValidationException(string message) : Exception(message);
