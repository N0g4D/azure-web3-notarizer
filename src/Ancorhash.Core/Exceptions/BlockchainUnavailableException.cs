namespace Ancorhash.Core.Exceptions;

/// <summary>Nodo RPC non raggiungibile o timeout (mappata su HTTP 502 dal layer API).</summary>
public sealed class BlockchainUnavailableException(string message, Exception? innerException = null)
    : Exception(message, innerException);
