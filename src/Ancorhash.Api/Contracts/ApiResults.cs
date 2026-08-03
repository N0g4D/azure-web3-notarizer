using Microsoft.AspNetCore.Mvc;

namespace Ancorhash.Api.Contracts;

/// <summary>Factory condivisa per le risposte di errore uniformi delle Functions.</summary>
public static class ApiResults
{
    public static ObjectResult Error(int statusCode, string detail) =>
        new(new ApiErrorResponse { Detail = detail }) { StatusCode = statusCode };
}
