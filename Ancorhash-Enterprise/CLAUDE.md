# Ancorhash Enterprise Guidelines

## Project Tech Stack
- .NET 10 (Azure Functions Isolated Worker)
- Architecture: Clean Architecture (Api -> Core & Infrastructure, Core -> zero dependencies)
- Web3: Nethereum (Polygon Relayer)

## Commands
- Build: `dotnet build src/Ancorhash.Api/Ancorhash.Api.csproj`
- Test: `dotnet test`
- Format: `dotnet format src/`

## Hard Rules
1. NEVER calculate or store raw document hashes on the backend. Accept ONLY pre-computed 64-character SHA-256 strings (GDPR compliance).
2. Clean Architecture: Domain entities & interfaces in Core. Web3 / Nethereum / Azure SDK calls in Infrastructure. Endpoints / Azure Functions in Api.
3. Configuration: Always use `IOptions<T>` pattern for dependency injection.
