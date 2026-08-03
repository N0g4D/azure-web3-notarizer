namespace Ancorhash.Core.Exceptions;

/// <summary>Broadcast rifiutato dal nodo RPC dopo i retry (mappata su HTTP 500 dal layer API).</summary>
public sealed class BlockchainTransactionException(string message, Exception? innerException = null)
    : Exception(message, innerException);
