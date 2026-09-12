# Arkiv friction report — Ancorhash @ ETHRome 2026

Bug report for the Arkiv bounty. Every entry below was reproduced by us, with
the exact command or URL used, on the date given. Nothing here is inferred:
where we did not verify something ourselves, we say so.

- **Team / project:** Ancorhash — Confidential RWA Vault
- **Network:** Tiramisu (`chainId 7738577`)
- **SDK target:** `@arkiv-network/sdk@0.8.0` + `viem`
- **Report opened:** 2026-09-11
- **Status:** first contact. Runtime friction (entity writes, queries,
  expiration, websocket) will be appended during Phase 2 — see *Still to come*.
- **Retracted:** an earlier entry claimed the MCP advertises `prepare_feedback`
  without exposing it. That was our error: `prepare_feedback` is an MCP
  **prompt**, listed under `prompts/list`, and we had only called `tools/list`.
  The entry was withdrawn rather than softened. Nothing in this report is kept
  unless we can reproduce it.

---

## F-01 · Three official sources give three different SDK versions

**Severity:** medium — there is no single answer to "which version do I install".

| Source | Version |
|---|---|
| ETHRome hacker manual, `manual/prizes.md:121` | `v0.7.x` |
| MCP `network_status` → `installCommand` | `@arkiv-network/sdk@0.8.0` |
| npm `dist-tags.latest` | `0.8.1` |

A team reading the printed manual installs a minor version behind the pinned
one; a team running plain `npm install @arkiv-network/sdk` gets `0.8.1`, which
no Arkiv-side source names.

**Reproduce**

```bash
npm view @arkiv-network/sdk dist-tags   # latest: 0.8.1
```

**Observed:** `latest = 0.8.1`, while `network_status` pins `0.8.0`.
**Expected:** the pinned version is the `latest` tag, or the mismatch is stated.
**Note:** we do not know whether `0.8.1` is compatible with Tiramisu. The MCP
declares `sdk: ["0.8.0"]` on its guides, so we pinned `0.8.0`.

---

## F-02 · The deprecated npm lineage is still live and still calls itself Arkiv

**Severity:** high for a newcomer — it is a silent wrong turn.

The manual warns that `arkiv-sdk` and `golem-base-sdk` are "the previous
lineage, not the one to install" (`manual/prizes.md:122`). Both are still
published, and **neither carries a deprecation notice on npm**. Worse, both
descriptions present themselves as current Arkiv:

| Package | Version | Description begins |
|---|---|---|
| `arkiv-sdk` | 0.1.19 | "This is part of the [Arkiv](https://github.com/Arkiv-Network) project…" |
| `golem-base-sdk` | 0.1.16 | "This is part of the [Golem Base](https://github.com/Golem-Base) project…" |

Someone searching npm for "arkiv sdk" finds a package whose own description
says it is part of the Arkiv project. Without the hacker manual in hand there
is no signal that it is the wrong one.

**Reproduce**

```bash
npm view arkiv-sdk version description
npm view golem-base-sdk version description
```

**Suggested fix:** `npm deprecate arkiv-sdk "Use @arkiv-network/sdk"` (same for
`golem-base-sdk`). One command, and the trap closes for everyone.

---

## F-03 · The Data Explorer does not offer Tiramisu, the event network

**Severity:** high — the advertised data surface cannot see the event network.

`network_status` returns `dataExplorerUrl: https://data.arkiv.network`, and
Arkiv's own probe in the same response contradicts it:

> `"observedNetworks": ["braga","kaolin"]`, `"tiramisuVerified": false`
> "The public Data Explorer did not offer Tiramisu in this check. Use the
> configured keyless SDK/RPC for current entity queries; recheck the UI at use."

So the tool a judge or a developer would naturally open to inspect entities
cannot select the network the hackathon runs on.

Related: the block explorer's data page
(`https://tiramisu.explorer.arkiv.network/data`) is served from
`/api/shadow-rpc/experimental` and labels itself **"EXPERIMENTAL — USE WITH
CAUTION"**. For a bounty whose evidence is "they run your query and see the
question answered", the two obvious inspection surfaces are one unavailable
and one experimental.

**Reproduce:** call `network_status` on the MCP and read `explorers.dataExplorer`;
then open `https://data.arkiv.network` and look at the network menu.

**Impact on us:** we cannot point a judge at a public UI to show our entities.
We will demo through the SDK instead and say why.

---

## F-04 · Currency of the bounty differs between sources

**Severity:** low, but it is money.

| Source | Amount |
|---|---|
| `hub.arkiv.network/ethrome` | **EUR** 2,500 (EUR 500 per mission, EUR 1,000 best use) |
| ETHRome manual `manual/prizes.md:109` | **$2,500 USDC on Ethereum**, "Arkiv confirmed the rail on 3 September" |

EUR and USD are not the same number. One of the two pages should move.

---

## F-05 · The ETHRome Hub page does not carry the schema template it is said to carry

**Severity:** medium — a named deliverable has no template behind it.

`manual/prizes.md:88` states:

> "Full requirements, **schema template** and support hours live on their
> ETHRome page, hub.arkiv.network/ethrome"

We read that page on 2026-09-11. It carries the missions, the weights, the MCP
setup and a Discord link. There is no `schema.md` template, no `friction.md`
instructions and no faucet/API-key walkthrough on it.

**Partly mitigated:** the MCP does expose `generate_entity_model` (Postgres DDL
→ entity model) and `check_schema`, which together cover the need — but nothing
on the public page points to them. A team that never connects the MCP never
finds out they exist.

---

## F-06 · Two live rubrics, and the printed one is wrong

**Severity:** high — a team optimising from the printed manual optimises for
the wrong thing.

| ETHRome manual (`prizes.md:94-98`) | Arkiv current (`guides/ethrome-current`, Hub) |
|---|---|
| Query depth **30** | Why Arkiv / Web3 database? **30%** |
| Evidence and reproducibility **20** | Technical execution **25%** |
| Arkiv fit and trade-offs **20** | Usefulness and adoption potential **20%** |
| Friction quality **20** | Arkiv feedback **25%** |
| Craft **10** | — |

The MCP guide is explicit that the old one is dead:

> "Do not restore the older five requirements, compulsory Saturday
> conversation, three-feedback-bullet minimum, old deadlines or the previous
> five-part ranking."

Same document also downgrades `arkiv/schema.md` from a qualification checkbox
to "useful project documentation… an optional evidence index, not the sole
entry route".

**Why it matters:** the hacker manual is the artefact handed to every
participant, and it is the one that is stale. We only found the discrepancy
because we connected the MCP. A team that prints the manual and never connects
will chase "query depth" and a Saturday deadline that no longer exists.

---

## F-07 · No .NET SDK: a C#/Azure shop pays for a second runtime

**Severity:** medium — not a defect, a gap. It changed our architecture.

Ancorhash is .NET 10 / Azure Functions with an existing Nethereum relayer.
`list_packages` returns four packages, all npm: `@arkiv-network/sdk@0.8.0`
(peer deps `viem ^2.0.0`, `typescript >=5.0.0`, `node >=18`), `arkiv-graph`,
`arkiv-chunking`, `arkiv-images`. Searching the knowledge base for
`dotnet C# SDK` and `csharp client` returns no .NET client. A Python SDK does
exist (`Arkiv-Network/arkiv-sdk-python`, referenced from `guides/known-issues`
with the caveat "Python source checked; Python execution not verified"), so
the gap is specifically .NET, not "TypeScript only".

**To be fair, the low-level path is fully documented** and we verified it in
`official/json-rpc/mutating-entities`: mutations are ordinary Ethereum
transactions to the precompile `0x4400000000000000000000000000000000000044`,
calldata is an ABI-encoded `execute((uint8,bytes)[])` with selector
`0x49650044`, tags 1..5. Nethereum can send that.

So this is not a blocker. The cost is that reaching it from C# means
hand-encoding the `Attribute[]` struct across all nine value types and
reimplementing the query side, with no SDK safety net — and the same page
says "Most developers should use the TypeScript SDK instead of raw
transactions." For a 40-hour build that is the wrong trade, so we introduced
a TypeScript writer process beside the .NET backend.

**What would have helped:** either a thin .NET client, or a short
"calling Arkiv from a non-TypeScript backend" page that gives the
`Attribute[]` encoding concretely. The protocol page documents the operation
structs but stops short of the attribute value encoding a non-TS
implementer needs most.

**Observed:** 2026-09-11, SDK 0.8.0, MCP `arkiv-ethrome` v1.0.19.

---

## F-08 · `check_schema` counters do not fire on valid input

**Severity:** medium — two of its warnings cannot be cleared, so a team either
churns on them or learns to ignore the tool.

`check_schema` returns an `observed` block with four counters. Two of them stay
at `0` regardless of what we send, while the matching warnings keep firing.

**`entityTypeHeadings` never leaves 0.** The warning says *"No entity type
heading was recognized."* We tried, in our real 430-line schema and then in
minimal documents, `## 2. Entity type: \`notarization\``,
`### Entity type: notarization` and `## Entities` + `### notarization`. All
return `entityTypeHeadings: 0`.

**Reproduce with five lines** — no project needed:

```bash
EP=https://arkiv-mcp-gateway.vercel.app/ethrome
curl -s -X POST "$EP" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_schema",
       "arguments":{"text":"# Schema\n\n## Entity type: notarization\n\nArkiv entities hold one notarization each.\n"}}}'
```

**Observed:** `{"entityTypeHeadings": 0, ...}` plus the warning.
**Expected:** either that heading counts, or the warning states the format it
wants. Today there is no way to satisfy it and no documented target.

**`multiFilterQueries` also stays 0.** Our file contains four `select()` chains
with three to five predicates each, both chained `.where(...).where(...)` and
several predicates inside one `where(a, b)`. `queryBuilderCalls` correctly
counted 4; `multiFilterQueries` stayed 0. Since query depth is the largest
scoring slice, a counter that reads 0 on genuinely compound queries is the one
most likely to mislead a team into rewriting working queries.

**Same for the vocabulary gate.** It asks for the product term *"Arkiv
entities"*; the file contains that exact phrase five times and the warning
persists.

**Caveat, stated honestly:** it is possible the checker expects a specific
structured format we did not guess. If so the gap is the message, which names
a heading rather than the format. The tool is explicit that it is a
`shallow_text_check` and *"does not prove application quality or a judging
outcome"*, so none of this is fatal — but the three findings above are the
ones a team cannot act on.

**What we did:** fixed the four actionable warnings (6 → 2), and left these
two rather than contorting the document to chase a regex.

**Observed:** 2026-09-11, MCP `arkiv-ethrome` v1.0.19, `configRevision`
`2026-09-11.4`.

---

## F-09 · `ExpirationTime.fromSeconds()` throws on values the prose docs invite

**Severity:** low, but it is a trap on the Mission 02 path.

`official/typescript-sdk/mutating-data` introduces the duration helpers as a
plain range — *"A variable expiry, from `fromSeconds()` up to `fromYears()`"* —
with no hint that the argument is constrained. The installed 0.8.0 typings say
otherwise:

```ts
/**
 * A raw number of seconds. Must be a whole number of blocks' worth — see the
 * other helpers, which all produce one by construction.
 * @throws {InvalidExpiryError} If the duration is not a positive multiple of
 *         the block time.
 */
fromSeconds: (seconds: number) => Lifetime
```

So `fromSeconds(60)` is fine at a 2-second block time and `fromSeconds(61)`
throws. A product that takes a lifetime in seconds from user input — ours does,
via `expiration_seconds` — hits this the first time someone enters an odd
number, and the constraint appears only in the JSDoc, not on the docs page that
teaches the API.

**Suggestion:** state the multiple-of-block-time rule on the Mutating data
page next to the helper list, or round internally and say so.

**Not a blocker for us:** we already moved to `fromBlocks()` after the
`check_schema` warning about wall-clock drift (see F-08 and `schema.md` §5), and
`fromBlocks` is *"the one duration with no conversion."* We would have hit this
had we kept the first design.

**Observed:** 2026-09-11, `@arkiv-network/sdk@0.8.0` installed from npm,
`integrity sha512-OnCrCfJqbnqr…`.

---

## What worked well

Recording this honestly, because the bounty asks for both.

- **`network_status` is the right first call.** One request returns chain ID,
  RPC, websocket, faucet, explorer, access keys and the exact pinned install
  command. Most stacks make you assemble that from five pages.
- **The MCP states its own limits.** Fields like `verificationScope:
  "rpc_chain_id_only"`, `probedOnRequest: false` and dated `checkedAt` stamps
  mean we know exactly how much a claim is worth. `tiramisuVerified: false`
  (F-03) is Arkiv reporting a gap in its own tooling rather than hiding it.
  That is unusually honest and it saved us a debugging session.
- **No key required to read.** The MCP never asks for a private key and says so
  up front, so connecting it carries no risk.

---

## Still to come (Phase 2)

Placeholders — to be filled with reproduced behaviour, not guesses:

- [ ] Faucet: wallet sign-in + CAPTCHA flow, time to first funded account
- [ ] Access keys: whether we hit rate limits without one
- [ ] First entity write: annotations vs payload, what the SDK accepts
- [ ] Compound query over typed attributes: operators available, what surprised us
- [ ] Mission 02 expiration: does absence-after-expiry behave as documented
- [ ] Mission 03 websocket: whether `subscribe` opens a real socket or polls
- [ ] `check_schema` / `check_submission` output against our real files

---

*Sources for every dated observation above: the ETHRome MCP at*
*`https://arkiv-mcp-gateway.vercel.app/ethrome` (server `arkiv-ethrome` v1.0.19),*
*`hub.arkiv.network/ethrome`, the npm registry, and the ETHRome hacker manual*
*submodule pinned in this repo at `hacker-manual/`.*
