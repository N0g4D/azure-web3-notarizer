# Ancorhash — ETHRome 2026 submission

**Confidential RWA Vault.** A notarization service where the document is
encrypted in the browser and stored on Swarm, its SHA-256 anchor becomes a
tokenized asset on Avalanche Fuji, and the queryable index lives on Arkiv with
an expiry the data enforces itself.

- **Repo:** https://github.com/N0g4D/azure-web3-notarizer (public)
- **Branch:** `ethrome-2026`
- **Demo video:** *(to be added — max 3 minutes)*
- **Deployed dapp:** **https://ancorhash.vercel.app** — a static read-only
  build. The registry is fully live there: it queries the public Arkiv index
  straight from the browser, with no backend, no account and no API key.
  Notarizing needs the Ancorhash relayer and is shown in the demo video.

**Try the verification without installing anything.** Paste this digest into
the Verify view:

```
91b4e781b2cbed53941e491a79de0b5981ba82de1a1b27b61fb5d5b02351a7bb
```

It is the SHA-256 of the string `Ancorhash ETHRome 2026 demo invoice`, so you
can reproduce it yourself:
`printf '%s' 'Ancorhash ETHRome 2026 demo invoice' | shasum -a 256`.
The record resolves to Arkiv entity
`0x76e41e75589611da561d5d452ecea278d54f885ec30586534eb20a9b26edca6d`, with a
24-hour index lifetime and a link to the Fuji anchor.

---

## 1. Pre-existing project declaration

**This project existed before ETHRome 2026.** Declared explicitly, as
`rules.md:50-52` requires. All three conditions are met:

1. **Declared.** Ancorhash was a working SHA-256 notarization PoC before the
   hackathon. This statement is the declaration.
2. **Only the new work should be judged.** Everything built during the event is
   isolated behind a tag.
3. **History is visible.** We did not open a new repository. The existing one
   was made public and worked on in place.

**The exact boundary, so judges can diff it:**

| | |
|---|---|
| Baseline tag | `pre-ethrome-2026` → commit `b83b45c`, dated **2026-08-05** |
| Hackathon work | **9 commits**, all after the tag |
| One-click diff | https://github.com/N0g4D/azure-web3-notarizer/compare/pre-ethrome-2026...ethrome-2026 |

The baseline is five weeks older than the event, so there is no ambiguity about
what predates it. What existed before: local SHA-256 hashing, a gas-sponsored
EVM relayer, a mock fiat checkout. What did **not** exist before: any Swarm,
Arkiv or Avalanche integration, and the ERC-721 contract.

---

## 2. Bounties claimed

### Swarm — claimed

The document is encrypted **in the browser** with `@snaha/swarm-id` and
uploaded to Swarm; only opaque bytes leave the device. With `encrypt: true` the
128-hex reference embeds its own decryption key, so it is treated as a bearer
secret and **never** transmitted: the backend receives only the first 64 hex,
the public address, via `toPublicAddress()`.

Swarm does real work here — it is the only place the document exists.

- Uses Swarm ID (no Bee node, postage stamps signed client-side)
- Storage and identity status surfaced in the UI: identity, address, batch id,
  `usable` / `NOT usable`
- Friction report at [`swarm/friction.md`](swarm/friction.md), including the
  issue that cost us hours: Swarm ID sign-in accepts **only a seed phrase**, so
  a gift-code private key cannot serve as an identity, while `canUpload` still
  reported `true` and the failure surfaced 30 s later as an opaque timeout

### Arkiv — claimed: Mission 02 "Built to expire" + Best Use

**Mission completed: Mission 02 — Built to expire.**

- [x] Mission 02, Built to expire
- [ ] Mission 01, Decommission — not attempted: we arrived with no indexer to
      decommission, and the brief says to pick another mission rather than
      invent one to turn off
- [ ] Mission 03, Live wire — not attempted: no websocket subscription

**Demonstrated lifetime: 55 blocks** (110 s at the nominal 2 s cadence,
measured at 2.00 s/block across 30-, 100- and 300-block windows immediately
before the run).

**Entity:** `0xf8134ba9ad7c2769732746f5aa02b353868621864a75943184f7bd103df5c493`
· created at block 358277 · `expiresAt` block **358332**, read back from the
`createEntity()` receipt rather than estimated.

**The same query, before and after natural expiration. No delete call in
between — the application never calls Delete (tag 5) at all.**

```ts
// identical on both sides of the boundary
publicClient
  .select({ key: true, attributes: true, payload: true, expiresAt: true })
  .where(eq('app', str('ancorhash')), eq('type', str('notarization')))
  .where(eq('document_hash', bytes32('0xea2c9a10…a118b')))
  .createdBy('0x8458cF7ED1f5CeA1fe2cD1aa34E67A53a88Bf38e')
  .fetch()
```

| When | Block | Query result |
|---|---|---|
| **BEFORE** 16:55:29 | 358287 | **1 entity returned** |
| **BEFORE** 16:56:53 | 358329 | **1 entity returned** |
| **AFTER** 16:56:58 | **358332** | **0 entities returned** |

**What changes in the application:** the record disappears from the index view.
Nothing deleted it — block 358332 simply arrived. The UI panel polls the query
on a 4 s interval rather than sleeping, so it records the *first* block at
which the entity stops being returned, and it distinguishes that from a failed
write: an entity that was never created renders as "INDEXING FAILED" with the
reason, never as an expiry.

**Why blocks and not seconds:** the ETHRome `check_schema` tool warned that
Tiramisu makes no wall-clock promise, and `guides/known-issues` records samples
from ~2 s to ~20 s per block. We use `ExpirationTime.fromBlocks()` — the one
duration form with no conversion — and read `expiresAt` back from the receipt
rather than trusting our own estimate.

**Query depth.** Four compound queries over typed attributes, in
[`arkiv/schema.md`](arkiv/schema.md) §7. Every one anchors on `createdBy()`,
because `app: "ancorhash"` is a string anyone can copy onto their own entities
while `$creator` cannot be forged.

**Attributes vs payload** is argued per field in `schema.md` §2–3, including
why `document_hash` and `swarm_address` are `bytes32` rather than `str`, and
why `notarized_at` must be `u64` for date-window queries to exist at all.

- Schema: [`arkiv/schema.md`](arkiv/schema.md)
- Friction report: [`arkiv/friction.md`](arkiv/friction.md)
- "Why Arkiv, and not Postgres": [`README.md`](README.md#why-arkiv), including
  what expiry does **not** do and what a normal database would do just as well

### Team1 — Track B, "Tokenized Assets: Rules to Settlement" — claimed, with a stated limit

`ConfidentialRWA` is an ERC-721 **deployed and exercised on Fuji**.

| Requirement | Status |
|---|---|
| Fuji deployment | **yes** — `0x01fBCFCb50638c90c8d48D1c8b6b109D7598BAB2` |
| A transaction | **yes** — mint, status 1, gas 116 118 |
| Asset rule | **deployed and exercised on Fuji** |
| Eligibility / transfer policy | **deployed**, readable on-chain; exercised in tests and on a local chain, **not yet on Fuji** |
| Settlement logic | **deployed**, readable on-chain; exercised in tests and on a local chain, **not yet on Fuji** |

**Asset rule.** `tokenId == uint256(documentHash)`, so a document can be
notarized exactly once — uniqueness is a property of the type, not a check that
can be forgotten. A second mint reverts inside `_mint`. Verified on Fuji:
`ownerOf` returns the relayer, `swarmAddressOf` returns the stored commitment,
`notarizedAtBlock` returns 58 332 070.

**Transfer policy.** `kycApproved` is enforced in `_update`, the single point
every movement passes through in OZ v5, so `transferFrom`, `safeTransferFrom`
and settlement are all covered with no bypass. Readable on Fuji:
`kycApproved(relayer) == true`.

**Settlement.** `settlePurchase()` is atomic delivery-versus-payment at
`SETTLEMENT_PRICE` (0.01 AVAX, readable on Fuji as `1e16`), with
checks-effects-interactions plus `nonReentrant`. A test proves a seller that
rejects funds reverts the whole thing rather than losing the token.

**The limit, stated rather than hidden:** the mint is proven on Fuji; the KYC
transfer and the settlement are proven by 14 passing Foundry tests and a full
local-chain run, but have not yet been executed **on Fuji**. Two transactions
would close that gap.

### ENS — not claimed

No ENSv2 integration. Claiming it would be false.

---

## 3. Links and on-chain evidence

**Avalanche Fuji** (chain id 43113)

| | |
|---|---|
| `ConfidentialRWA` | [`0x01fBCFCb50638c90c8d48D1c8b6b109D7598BAB2`](https://testnet.snowtrace.io/address/0x01fBCFCb50638c90c8d48D1c8b6b109D7598BAB2) |
| Mint transaction | [`0x039f85a4…3963e`](https://testnet.snowtrace.io/tx/0x039f85a41057619ba274a8212d50b95accd50c2187e48dcceff82e5ec0b3963e) |
| Token name / symbol | Ancorhash Confidential RWA / ACRWA |
| Relayer / owner | `0x8458cF7ED1f5CeA1fe2cD1aa34E67A53a88Bf38e` |

**Arkiv** (Tiramisu, chain id 7738577)

| | |
|---|---|
| Mission 02 entity | `0xf8134ba9ad7c2769732746f5aa02b353868621864a75943184f7bd103df5c493` |
| Entity creator | `0x8458cF7ED1f5CeA1fe2cD1aa34E67A53a88Bf38e` |
| Explorer | https://tiramisu.explorer.arkiv.network |

**Repository**

| | |
|---|---|
| Repo | https://github.com/N0g4D/azure-web3-notarizer |
| Baseline tag | https://github.com/N0g4D/azure-web3-notarizer/releases/tag/pre-ethrome-2026 |
| Hackathon diff | https://github.com/N0g4D/azure-web3-notarizer/compare/pre-ethrome-2026...ethrome-2026 |

---

## 4. Architecture in one paragraph

Three systems, each doing the one thing it is good at. **Swarm** holds the
document, encrypted, with the key never leaving the browser. **Avalanche Fuji**
holds the integrity anchor as a tokenized asset with an issuance rule, a
transfer policy and settlement. **Arkiv** is the queryable, signed, expiring
index over both — it stores commitments, never content. The .NET backend
relays and pays gas so corporate users never touch a wallet; a small Node
process bridges to Arkiv because the Arkiv SDK is TypeScript-only.

## 5. Known limitations

Written down because a judge will find them anyway.

- **`org` is declared, not proven.** Entities are signed by our relayer, which
  is what lets users notarize without a wallet. The signature proves *Ancorhash
  wrote this record*, not that the named organisation authorised it.
- **One wallet signs both sides of the proof.** The Arkiv entity creator and
  the Fuji anchor are currently the same key, so cross-checking `$creator`
  against the anchor's `from` address proves the two records are *consistent*,
  not that two independent parties attested. Separating them is configuration,
  not code: the two values already come from distinct settings keys.
- **Expiry is not revocation.** It removes the entity from the public index. It
  does not delete the blob on Swarm, does not revoke the decryption key, and
  does not undo reads already made. See `README.md`.
- **`kycApproved` is an owner-managed whitelist**, not identity verification.
- **No audit.** Hackathon code, testnet only.

## 6. How to run

See [`README.md`](README.md). Two faucets are needed: Core for Fuji test AVAX,
and the Arkiv Hub for test GLM.
