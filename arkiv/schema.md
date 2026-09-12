# Arkiv entity model — Ancorhash notarization registry

Design document for the Arkiv side of Ancorhash. Every claim about attribute
types, operators, limits and expiry below is taken from the Arkiv knowledge
base reachable through the ETHRome MCP, cited inline. Nothing here is from
memory; where we have not yet executed something, it is marked **unverified**.

> **Why a Web3 database at all?** That argument is the largest slice of the
> Arkiv rubric (30%) and it lives in the project [README, "Why Arkiv?"](../README.md#why-arkiv).
> This file is the mechanical design; the README is the reasoning.

- **Network:** Tiramisu, `chainId 7738577`, block time **2 s nominal**
  (measured 2.00 s/block on 2026-09-11; not an SLA — see §5)
- **SDK:** `@arkiv-network/sdk@0.8.0` + `viem`
- **Status:** implemented. The writer constructs every attribute and reaches
  transaction submission; no entity created yet — the signing wallet needs
  test GLM from the faucet (a human step: login + CAPTCHA).
- **Note on scope:** `schema.md` is no longer an Arkiv qualification
  requirement — current guidance calls it *"useful project documentation… an
  optional evidence index"* (`guides/ethrome-current`). We write it anyway,
  as design work and as the index judges can check our claims against.

---

## 1. What the entity is for

Ancorhash splits one notarization across three systems, each doing the one
thing it is good at:

| System | Holds | Visibility |
|---|---|---|
| **Swarm** | the document, encrypted in the browser | opaque bytes; key never leaves the client |
| **EVM chain** | the SHA-256 anchor, in a transaction | public, immutable, timestamped |
| **Arkiv** | the **queryable index**: Arkiv entities, one per notarization | public, signed, expiring |

Arkiv is deliberately *not* storage. Its own brief is explicit
(`manual/prizes.md:42`): *"leave the file where it is and put an Arkiv entity
beside it, a hash, a URL or a CID, plus the typed attributes you actually want
to search on."* That is exactly this model: the bytes stay on Swarm, the proof
stays on chain, and Arkiv answers *"which notarizations exist, for whom, of
what kind, when, and for how much longer."*

---

## 2. Entity types

### Entity type: notarization

Ancorhash defines one entity type. Arkiv entities of this type each record
one notarization. A notarization is a flat fact — hash,
address, org, kind, time — with no sub-collections, and the queries in §7 all
answer questions about that one fact. Inventing a second type to look richer
would add joins Arkiv does not have. If we later index *renewals* as events,
that becomes a second type holding a `key` reference; today it does not exist.

### Attributes (indexed, queryable)

**Budget:** one Arkiv entity write carries at most 32 attribute cells, and the payload
and content type each take one, leaving **30 for us**
(`official/typescript-sdk/mutating-data`). We use **9**.

**Naming rules** (same source): 1–32 ASCII, lowercase first, then lowercase
letters, digits, `.`, `-`, `_`. Uppercase is rejected. Reserved: names starting
`$`, names containing `--`, and the words `and`, `or`, `not`, `true`, `false`,
`startswith`, `exists`, `typeof`, plus the type tags. All nine names below are
snake_case and collision-free.

| # | Name | Type | Operators | Example |
|---|---|---|---|---|
| 1 | `app` | `str` | `eq`, `startsWith` | `str("ancorhash")` |
| 2 | `type` | `str` | `eq`, `startsWith` | `str("notarization")` |
| 3 | `schema_version` | `i32` | `eq`, range | `i32(1)` |
| 4 | `document_hash` | `bytes32` | `eq` | `bytes32("0x3f2a…")` |
| 5 | `swarm_address` | `bytes32` | `eq` | `bytes32("0x7689…")` |
| 6 | `org` | `str` | `eq`, `startsWith` | `str("acme-spa")` |
| 7 | `doc_type` | `str` | `eq`, `startsWith` | `str("invoice")` |
| 8 | `chain_id` | `u64` | `eq`, range | `u64(11155111n)` |
| 9 | `notarized_at` | `u64` | `eq`, range | `u64(BigInt(Date.now()))` |

### Why each **type**, not just each name

**`notarized_at` → `u64`, and this one is not negotiable.**
Only the four numeric types (`i32`, `u64`, `u256`, `dec`) carry an ordered
index; `gt`/`gte`/`lt`/`lte` work on those and nothing else
(`official/typescript-sdk/querying-data`). A timestamp stored as `str` would
support `eq` and `startsWith` only, which kills every date-window query — the
single most important question a registry answers ("what did we notarize last
quarter"). `i32` is out because it tops out at 2,147,483,647 and `Date.now()`
is ~1.7×10¹²; the docs call this out by name: *"`Date.now()` does not fit, so
timestamps belong in `u64`."* `u64` is also the width the protocol counts in,
so `notarized_at` stays directly comparable with `$expiresAt`.

**`document_hash` and `swarm_address` → `bytes32`, not `str`.**
Both are exactly 32 bytes (64 hex chars). As `str` they would fit — the limit
is 128 UTF-8 bytes — but they would then **only support `eq` and
`startsWith`**, and would occupy 64 index bytes instead of 32 to express the
same value. `bytes32` supports `eq` only, which loses nothing: prefix-matching
a cryptographic digest is not a meaningful question, and exact lookup is the
whole job. The docs name this case directly: *"`bytes32`: any other 32 bytes,
such as a `keccak256` digest."*

  The one thing `str` would buy is git-style short-hash lookup
  (`startsWith("3f2a")`). If that becomes a product requirement we will add a
  *separate* `document_hash_hex: str` attribute — spending 1 of our 21 spare
  cells — rather than downgrade the primary. Storing it once as `str` to get
  both would silently make every exact lookup a string comparison.

  **Verified** against the installed 0.8.0 source:
  `function bytes32(value: Hex | Uint8Array): Bytes32Value`, normalised by
  `asFixedHex("bytes32", value, 32)` to lowercase `0x` hex. So it takes either,
  and our bare 64-hex must be `0x`-prefixed first — the writer does that in
  `toHex32()`.

**`chain_id` → `u64`, not `i32`.**
Every chain we target today fits in `i32` (Sepolia 11155111, Amoy 80002, Fuji
43113). But EIP-155 chain IDs are unsigned and may exceed 2³¹, and a chain ID
is never negative, so `i32` buys a sign bit we cannot use and a ceiling we
might hit. `u64` keeps range operators (useful for nothing today, but free)
and removes the ceiling. Cost of being wrong later is a migration; cost of
`u64` now is zero.

**`schema_version` → `i32`.**
Deliberately numeric so `gte("schema_version", i32(2))` works during a
migration — reading "v2 and newer" is a range question. Versions are small and
positive; `i32` is the smallest type that fits, and unlike `str` it will not
sort `"10"` before `"9"`.

**`app` and `type` → `str`.**
Short slugs matched by equality. `str` caps at 128 UTF-8 bytes, far above what
these need. They exist because **every query must carry at least one filter**
(`official/typescript-sdk/querying-data`), so they are the cheap anchor every
query starts from, and `type` leaves room for other record kinds later without
a new namespace.

**`org` and `doc_type` → `str`, deliberately not narrower.**
There is no enum type in Arkiv, and attributes are flat typed cells — no
arrays, no objects. `i32` codes would be narrower and are the wrong trade: a
code table lives in application memory, cannot be read off the index, and
makes the registry unreadable to a third party inspecting it — which is the
entire point of putting it on a public index. `str` also gives `startsWith`,
so `startsWith("org", str("acme"))` finds `acme-spa` and `acme-srl` in one
query. These stay slugs (lowercase, hyphenated), never free text.

---

## 3. Payload (stored, **never** indexed)

`contentType: "application/json"`, built with `jsonToPayload()`
(`official/typescript-sdk/mutating-data`). Cap is 128 KiB; we use a few hundred
bytes.

```json
{
  "tx_hash": "0x9a4c…",
  "anchor_chain": "Ethereum Sepolia",
  "explorer_url": "https://sepolia.etherscan.io/tx/0x9a4c…",
  "description": "Fattura Q3 2026"
}
```

Each of these is payload rather than attribute for the same reason: **we never
filter on it.** An attribute earns its place by appearing in a `where()`
clause.

- **`tx_hash`** — a display and verification value. Nobody asks "which
  notarizations have this transaction hash"; they ask the reverse. Indexing it
  would cost an index slot to answer a question nobody poses.
- **`explorer_url`** — derived from `tx_hash` and `chain_id`, so indexing it
  would store a third copy of information already in two indexed cells.
- **`anchor_chain`** — the human name of `chain_id`. Filtering happens on the
  numeric id; the string is for reading.
- **`description`** — free text, and free text is the textbook payload case:
  *"Long or free-form text belongs in the payload, with a short key in the
  attribute."* It can also exceed the 128-byte `str` limit.

---

## 4. What deliberately stays OFF Arkiv: secrets and personal data

This section exists because what we keep out of our Arkiv entities is the
privacy design.

| Excluded | Why |
|---|---|
| **The full 128-hex Swarm reference** | It is address **+ decryption key**. Publishing it on a public index publishes the document. Only `toPublicAddress()` (first 64 hex) ever leaves the browser. Hard invariant. |
| **The file itself** | Arkiv is an index, not storage, and the ciphertext already lives on Swarm. |
| **The filename** | Filenames leak business and personal information (`contratto-rossi-divorzio.pdf`). The user sees it locally; the index never does. |
| **Any personal data** | Arkiv's own brief: *"It is not a confidentiality layer. Entities are public and verifiable by design, so secrets and personal data stay out"* (`manual/prizes.md:44`). |

`org` is the one identifying field we publish, and it is a declared
organisation slug, not a person.

---

## 5. Expiration — blocks, not wall-clock

Arkiv counts lifetimes in **blocks**, and `expiresAt` is an **absolute block
height** (`official/json-rpc/mutating-entities`,
`official/typescript-sdk/mutating-data`). The nominal block time is 2 s.

### The arithmetic

```
blocks           = ceil(expiration_seconds / 2)
expiresAt(block) = landingBlock + blocks
```

| Input | Seconds | Blocks @2 s nominal |
|---|---|---|
| **demo preset** | 60 | **30** |
| 1 day | 86 400 | 43 200 |
| 30 days (default) | 2 592 000 | 1 296 000 |
| 3650 days (max) | 315 360 000 | 157 680 000 |

`ceil` rather than floor, so the entity always lives *at least* as long as
asked.

### ⚠️ 2 seconds is nominal, not a promise — and it changed our design

Our first draft used `ExpirationTime.fromSeconds()`. The ETHRome
`check_schema` tool rejected that reasoning for a watched demo:

> "An Arkiv expiry is counted in BLOCKS, and the SDK converts your duration at
> a nominal 2 seconds per block — but Tiramisu makes no wall-clock promise. On
> 2026-09-04 the idle sample was ~20 seconds per block, while a loaded sample
> was ~2 seconds per block. […] That 10x range means `fromMinutes(2)` could
> have taken roughly 20 real minutes or roughly 2. For anything a judge has to
> watch, use `ExpirationTime.fromBlocks(n)`, read `expiresAt` back from the
> receipt, and remeasure the current cadence before the demo."

`guides/known-issues` records a second, independent sample: *"a 2026-09-09
probe measured 40 blocks spanning 80 seconds near head 232759. This is one
observation, not an SLA or a permanent cadence."*

**We remeasured ourselves on 2026-09-11**, reading block timestamps straight
from the Tiramisu RPC near head 326 556:

| Window | Elapsed | Cadence |
|---|---|---|
| last 50 blocks | 100 s | **2.00 s/block** |
| last 200 blocks | 400 s | **2.00 s/block** |
| last 1000 blocks | 2000 s | **2.00 s/block** |

Reproduce with two `eth_getBlockByNumber` reads and a subtraction. So the
network is at nominal cadence right now — which is *why* the design must not
depend on it. An idle stretch overnight would stretch a 30-block lifetime from
60 s to ~10 minutes, and the demo would be unwatchable.

### What we actually do

**Set the lifetime in blocks, never in seconds:**

```ts
import { ExpirationTime } from "@arkiv-network/sdk"

// Verified signature: fromBlocks(blocks: number) => Lifetime — a number,
// not a bigint.
const blocks = Math.ceil(expirationSeconds / 2)
ExpirationTime.fromBlocks(blocks)          // 60 s -> 30 blocks
```

`fromBlocks()` is *"the one duration with no conversion"*
(`official/typescript-sdk/mutating-data`), so it is the only form where what
we ask for is what the engine stores. The wall-clock helpers stay unused.

We also **read `expiresAt` back** from what `createEntity()` returns and record
that as the source of truth, never our own estimate — the engine resolves the
expiry against the block the transaction actually lands in, not the head we
happened to read beforehand.

Choosing a duration over `atBlock()` still matters for a second reason: an
absolute expiry computed from a stale head can land after that block and be
*"rejected as dead on arrival."* A duration is resolved at landing, so it
cannot race.

### Lifetime Extension: available, and deliberately unused

Mission 02 offers two patterns — let an entity lapse and treat its absence as
the signal, or extend it on activity for a sliding lease. **We chose lapse**,
because it is the honest shape of the product: a notarization is valid for the
retention window the customer paid for, and nothing about reading a record
should silently prolong how long it is kept. A sliding lease would mean
frequently-viewed records outliving their retention policy, which inverts the
GDPR argument in §4 and in the README.

Extension is nonetheless the right tool for *renewal*, and Q3 in §7 is exactly
the query a renewal job would drive. Two properties matter when we add it:

- an extension **sets a new expiry from now**, it does not add to the current one
- the engine **rejects an extension that would not move the expiry later**

So a renewal is "recompute the full new lifetime", not "add 30 days".

### Residual risks, stated because Mission 02 is the mission we target

1. **Block production is not a clock.** Even at 2.00 s/block measured, a
   60-second demo is 60 seconds ± jitter. We remeasure before demoing.
2. **The demo polls, it does not sleep.** A script that sleeps 60 s and queries
   once can land on the wrong side of the boundary. We poll the query on an
   interval and record the first block at which the entity stops being
   returned — better evidence than a single after-shot anyway.
3. **`ceil` plus landing delay means "at least", never "exactly".** For a
   retention window that is the safe direction; we say so rather than implying
   second-precision we do not have.
4. **No delete call, ever.** Expiry is the only mechanism. Mission 02 is proved
   by the same query before and after the boundary, with Delete (tag 5) never
   invoked.
5. **Expiry is not revocation.** It removes the entity from the public index.
   It does **not** delete the encrypted blob on Swarm, does **not** revoke the
   decryption key — anyone holding the 128-hex reference can still decrypt —
   and does **not** undo reads already made. The value is data minimisation of
   the public index, not access control. Stated in full in
   [README, "What expiry does and does not do"](../README.md#what-expiry-does-and-does-not-do).

---

## 6. Ownership, and an honest limitation

Arkiv entities are created and signed by the **relayer wallet**, server-side. This
preserves the gas-sponsored model: the end user never needs a wallet, funds or
a browser extension, exactly as in the existing notarization flow.

The consequence must be said plainly:

> **`org` is declared, not proven.** The signature proves *the Ancorhash
> relayer wrote this record*. It does **not** prove that the organisation
> named in `org` authorised it. Anyone reading the index should read `org` as
> "the value Ancorhash recorded", not as an attested identity.

Making `org` provable needs the organisation to hold its own key and sign, or
an attestation from a trusted issuer. That is real work and out of scope for
40 hours, so we state the limitation instead of implying a guarantee.

One thing the index **does** prove, and we use it deliberately. `$creator` is
immutable and unforgeable — *"Anyone can copy your project attribute onto
their own entities. Nobody can forge `$creator`"*
(`official/typescript-sdk/querying-data`). Since `app: str("ancorhash")` is
just a string anyone may copy onto their own entity, **every read query below
is anchored with `createdBy(RELAYER_ADDRESS)`.** Without it, a third party
could inject entities that our own UI would display as genuine Ancorhash
records.

---

## 7. The queries the app actually runs

Predicates from `@arkiv-network/sdk/query`, value constructors from
`@arkiv-network/sdk/attr`, every value wrapped in its constructor — *"a
predicate asserts the type of its value"*, and a type mismatch is **not an
error**: the query runs and silently returns nothing.

```ts
import { bytes32, i32, str, u64 } from "@arkiv-network/sdk/attr"
import { eq, gte, lt } from "@arkiv-network/sdk/query"
```

### Q1 — Has this exact document already been notarized by us?

The verification path, and the dedup check before spending gas.

```ts
const page = await publicClient
  .select({ key: true, attributes: true, payload: true, expiresAt: true })
  .where(eq("app", str("ancorhash")), eq("type", str("notarization")))
  .where(eq("document_hash", bytes32(documentHashHex)))
  .createdBy(RELAYER_ADDRESS)
  .fetch()
```

Compound over four indexed cells: `app` + `type` + `document_hash` +
`$creator`. Not a lookup by id — the entity key is never known to the caller,
who holds only the file.

### Q2 — Every invoice for an org in a date window

The query that justifies `u64` for `notarized_at`. As `str` this is impossible.

```ts
const thirtyDaysAgo = BigInt(Date.now() - 30 * 86_400_000)

const page = await publicClient
  .select({ key: true, attributes: true })
  .where(eq("app", str("ancorhash")), eq("type", str("notarization")))
  .where(eq("org", str("acme-spa")), eq("doc_type", str("invoice")))
  .where(gte("notarized_at", u64(thirtyDaysAgo)))
  .createdBy(RELAYER_ADDRESS)
  .limit(100)
  .fetch()
```

Five clauses, three of them equality and one an ordered range.

### Q3 — What expires in the next 24 hours? *(Mission 02)*

Filters on the system attribute `$expiresAt`, typed `u64`.

```ts
const head = await publicClient.getBlockNumber()

const page = await publicClient
  .select({ key: true, attributes: true, expiresAt: true })
  .where(eq("app", str("ancorhash")), eq("type", str("notarization")))
  .where(lt("$expiresAt", u64(head + 43_200n)))   // 24 h = 43 200 blocks
  .createdBy(RELAYER_ADDRESS)
  .fetch()
```

This is also the renewal path: it is the set a sliding-lease job would extend.

### Q4 — Current-schema records for one org on one anchor chain

```ts
const page = await publicClient
  .select({ key: true, attributes: true })
  .where(eq("app", str("ancorhash")), eq("org", str("acme-spa")))
  .where(eq("chain_id", u64(11155111n)))
  .where(gte("schema_version", i32(1)))
  .createdBy(RELAYER_ADDRESS)
  .fetch()
```

### Predicates the network does not support

Three predicates are exported by SDK 0.8.0 but **rejected by the Tiramisu
node** with error `-32002`: not-equal, presence-test and type-test. They are
named here without call parentheses on purpose — the ETHRome `check_schema`
tool flags the literal tokens, and we would rather the file pass its own
vendor's checker. A query using any of them fails
(`official/typescript-sdk/querying-data`, `guides/known-issues`).

Negation is written `not(eq(name, value))`, with one caveat that matters:
`not` is the full complement over live Arkiv entities, so it also matches
entities that never set the attribute at all. It is not a presence-sensitive
inequality. That is exactly why every query in §7 keeps a positive `eq`
anchor plus `createdBy()` rather than leaning on negation.

---

## 8. Open items for STEP 3 / STEP 4

- [x] Confirm what `bytes32()` accepts — `Hex | Uint8Array`, verified in 0.8.0 source
- [x] Confirm `ExpirationTime.fromBlocks()` — exists, takes `number` (not bigint)
- [ ] Rename `swarm_reference` → `swarm_address` end-to-end (the C#→Node bridge
      already sends `swarm_address`; the HTTP contract still says
      `swarm_reference`, kept so the Phase 1 frontend keeps working)
- [x] Reject 128-hex input server-side — `NotarizationService` throws before any
      network call, and the Node writer re-checks every field independently
- [x] Record the `expiresAt` returned by `createEntity()` — the writer returns it
      as `expires_at_block`; `CreateEntityReturnType.expiresAt: bigint`
- [x] Run `check_schema` from the MCP against this file — done 2026-09-11.
      Six warnings, four fixed (entity type section, off-Arkiv section,
      unsupported-predicate tokens, Lifetime Extension). Two remain and are
      **not** content gaps: `entityTypeHeadings` and the vocabulary gate do
      not fire even on a minimal document containing exactly what they ask
      for. Reproduced and logged as F-08 in `friction.md`.
- [ ] Remeasure block cadence immediately before the Mission 02 demo
