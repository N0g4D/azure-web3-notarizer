# ETHRome 2026: Ancorhash Confidential RWA Vault

## Goal
Transform Ancorhash from a basic SHA-256 local hasher into a Confidential RWA Vault leveraging Swarm (Encrypted Storage), Arkiv (Metadata & Sliding Lease), and Avalanche Fuji (RWA Tokenization).

## Constraints & Rules
- **Zero Data Leakage:** The raw document MUST NEVER leave the React frontend in plaintext.
- **Sponsor Bounties Target:** Swarm ID integration, Arkiv Mission 02 (Built to expire), Team1 Avalanche Fuji Track B.
- **Reference:** Always adhere to rules in `hacker-manual/HACKER-MANUAL.md`.

## Phased Execution Plan

### Phase 1: Frontend & Swarm (Current Focus)
1. Install `@snaha/swarm-id` in `src/Ancorhash.Web/`.
2. Refactor `src/Ancorhash.Web/src/lib/hash.ts`: Replace local SHA-256 generation with client-side encryption and Swarm upload. Return the Swarm content hash reference.
3. Update `src/Ancorhash.Web/src/lib/api.ts`: Expand `NotarizeRequest` to accept `swarm_reference` (string) and `expiration_days` (number).
4. Update `src/Ancorhash.Web/src/App.tsx`: Add UI input for "Days of validity", wire up the Swarm upload, and remove the Azure AI extraction logic to rely on manual user input for public metadata.

### Phase 2: Backend & Arkiv (Pending)
- C# Azure Functions integration with Arkiv SDK to store public metadata and Swarm reference.
- Implement Arkiv Mission 02: set an automatic expiration on the Arkiv entity based on `expiration_days`.

### Phase 3: Backend & Avalanche Fuji (Pending)
- Refactor `NethereumBlockchainRelayer.cs` to mint an RWA token on Avalanche Fuji C-Chain instead of a 0-ETH data transaction.