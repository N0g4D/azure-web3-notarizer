/**
 * Arkiv READ path: queries against the public index, straight from the
 * browser. Hybrid architecture: the relayer signs writes server-side, reads
 * run here.
 *
 * The public client signs nothing and needs no keys, so it is safe to ship in
 * the bundle. THE ACCESS KEY DOES NOT BELONG HERE: it would appear in the
 * network requests of anyone who opens the page. The frontend uses the
 * rate-limited public RPC.
 */
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { bytes32, str, u64 } from '@arkiv-network/sdk/attr'
import { eq, gte, lt } from '@arkiv-network/sdk/query'
import { http } from 'viem'

/** Must stay aligned with SCHEMA_VERSION in the writer (arkiv/schema.md §2). */
export const SCHEMA_VERSION = 1

/**
 * Wallet that SIGNS the Arkiv entities. Shared configuration across the two
 * runtimes: the backend holds the key, the frontend only the address.
 *
 * It matters because every query anchors on createdBy(). `app: "ancorhash"`
 * is a string anyone can copy onto their own entities; `$creator` cannot be
 * forged. Without that anchor a third party could inject entities our own UI
 * would display as genuine.
 */
export const ARKIV_CREATOR_ADDRESS = import.meta.env
  .VITE_ARKIV_CREATOR_ADDRESS as `0x${string}` | undefined

/** Tiramisu RPC. Empty = the default public endpoint. */
const ARKIV_RPC_URL = import.meta.env.VITE_ARKIV_RPC_URL as string | undefined

export const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(ARKIV_RPC_URL || undefined),
})

/**
 * 64 hex without a prefix -> lowercase `0x` Hex.
 *
 * MUST produce exactly the same form as `toHex32` in the Node writer. A
 * mismatch raises no error: on Arkiv a value that does not match simply
 * returns zero results, silently. That is the kind of bug you discover during
 * a demo. The cross-runtime test in `test/hex32.test.ts` compares the two
 * implementations by running both.
 */
export function toHex32(value: string): `0x${string}` {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `Expected 64 hex characters without 0x, got ${value.length}.`,
    )
  }
  return `0x${value.toLowerCase()}` as `0x${string}`
}

/** Anchor shared by every query: namespace + type + verifiable creator. */
function anchored() {
  const builder = publicClient
    .select({
      key: true,
      attributes: true,
      payload: true,
      expiresAt: true,
    })
    .where(eq('app', str('ancorhash')), eq('type', str('notarization')))
  return ARKIV_CREATOR_ADDRESS
    ? builder.createdBy(ARKIV_CREATOR_ADDRESS)
    : builder
}

export interface NotarizationRecord {
  entityKey: string
  documentHash?: string
  swarmAddress?: string
  org?: string
  docType?: string
  chainId?: string
  notarizedAt?: number
  expiresAtBlock?: bigint
  payload?: Record<string, unknown>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRecord(entity: any): NotarizationRecord {
  const a = entity.attributes ?? {}
  let payload: Record<string, unknown> | undefined
  try {
    payload = entity.toJson?.()
  } catch {
    payload = undefined
  }
  return {
    entityKey: entity.key,
    documentHash: a.document_hash?.value,
    swarmAddress: a.swarm_address?.value,
    org: a.org?.value,
    docType: a.doc_type?.value,
    chainId: a.chain_id?.value?.toString(),
    notarizedAt: a.notarized_at?.value ? Number(a.notarized_at.value) : undefined,
    expiresAtBlock: entity.expiresAt,
    payload,
  }
}

/**
 * Q1 from schema.md §7 — has this document already been notarized by us?
 * It is also the query that proves Mission 02: before expiry it returns the
 * entity, after it returns nothing, with no Delete call in between.
 */
export async function findByDocumentHash(
  documentHash: string,
): Promise<NotarizationRecord[]> {
  const page = await anchored()
    .where(eq('document_hash', bytes32(toHex32(documentHash))))
    .fetch()
  // Same collapse as the register: re-indexing can leave more than one entity
  // for a document, and the caller wants the live one.
  return dedupeByDocument(page.entities.map(toRecord))
}

/**
 * Registry listing: every notarization this creator wrote, narrowed by the
 * filters the caller supplies.
 *
 * This is the auditor's entry point, and it is deliberately usable with no
 * filters at all. `app` + `type` + `createdBy()` already satisfies Arkiv's
 * "a query needs at least one filter" rule, so the registry can be browsed by
 * someone who does not yet know which organisation slugs exist — which is the
 * normal case for a third party reviewing what was registered.
 *
 * `org` and `doc_type` narrow by equality and `notarized_at` by an ordered
 * range (possible only because it is `u64`) — all server-side, in one
 * compound query.
 *
 * `expiringWithinBlocks` is deliberately NOT a server-side predicate, and the
 * reason is worth stating. A range on `$expiresAt` filters *entities*, but the
 * question being asked is about *documents*, and a document's real expiry is
 * the maximum over its entities (see `dedupeByDocument`). Filtering on the
 * server first would surface a superseded entity while leaving its live
 * replacement outside the result set — reporting a document as lapsing when it
 * is not. We observed exactly that: an old 24 h entity matched while its
 * 7-day replacement did not. So the set is deduped to a true per-document
 * expiry first, then filtered. `findExpiringWithin` below keeps the pure
 * server-side range for the cases that genuinely ask about entities.
 */
export interface RegistryFilters {
  org?: string
  docType?: string
  /** Epoch ms: only records notarized at or after this instant. */
  sinceMs?: number
  /** Only records whose index entry lapses within this many blocks. */
  expiringWithinBlocks?: bigint
  limit?: number
}

/**
 * Collapses several entities for the same document into one, keeping the
 * longest-lived.
 *
 * The chain enforces one token per document — `tokenId == uint256(documentHash)`,
 * so a second mint reverts. **Arkiv enforces no such rule**: attributes are not
 * unique, so the index can legitimately hold two entities for one document.
 * That is not corruption, it is the recovery path working: when an anchor
 * succeeds but the index write fails (`arkiv_indexed: false`), re-indexing
 * writes a fresh entity beside the old one, and re-indexing after a lapse does
 * the same.
 *
 * A register should show one row per document, so the read path collapses them
 * and keeps the entry that is still valid furthest into the future.
 */
export function dedupeByDocument(records: NotarizationRecord[]): NotarizationRecord[] {
  const best = new Map<string, NotarizationRecord>()
  for (const record of records) {
    const key = record.documentHash ?? record.entityKey
    const seen = best.get(key)
    if (
      seen === undefined ||
      (record.expiresAtBlock ?? 0n) > (seen.expiresAtBlock ?? 0n)
    ) {
      best.set(key, record)
    }
  }
  return [...best.values()]
}

export async function queryRegistry(
  filters: RegistryFilters = {},
): Promise<{ head: bigint; records: NotarizationRecord[] }> {
  const head = await publicClient.getBlockNumber()
  let builder = anchored()

  if (filters.org) builder = builder.where(eq('org', str(filters.org)))
  if (filters.docType) {
    builder = builder.where(eq('doc_type', str(filters.docType)))
  }
  if (filters.sinceMs !== undefined) {
    builder = builder.where(gte('notarized_at', u64(BigInt(filters.sinceMs))))
  }
  const page = await builder.limit(filters.limit ?? 100).fetch()
  let records = dedupeByDocument(page.entities.map(toRecord))

  // Applied after the collapse, so it reads a document's true expiry.
  if (filters.expiringWithinBlocks !== undefined) {
    const deadline = head + filters.expiringWithinBlocks
    records = records.filter(
      (r) => r.expiresAtBlock !== undefined && r.expiresAtBlock < deadline,
    )
  }

  // Newest first: the index has no ordering guarantee we can rely on, and an
  // auditor reads a register from the most recent entry backwards.
  records.sort((a, b) => (b.notarizedAt ?? 0) - (a.notarizedAt ?? 0))
  return { head, records }
}

/** Q2 — an organisation's records within a time window. */
export async function findByOrgSince(
  org: string,
  sinceMs: number,
  docType?: string,
): Promise<NotarizationRecord[]> {
  let builder = anchored().where(eq('org', str(org)))
  if (docType) builder = builder.where(eq('doc_type', str(docType)))
  const page = await builder
    .where(gte('notarized_at', u64(BigInt(sinceMs))))
    .limit(100)
    .fetch()
  return page.entities.map(toRecord)
}

/** Q3 — what expires within N blocks. Filters on the $expiresAt system attribute. */
export async function findExpiringWithin(
  blocks: bigint,
): Promise<{ head: bigint; records: NotarizationRecord[] }> {
  const head = await publicClient.getBlockNumber()
  const page = await anchored()
    .where(lt('$expiresAt', u64(head + blocks)))
    .fetch()
  return { head, records: page.entities.map(toRecord) }
}

/** Current chain height: drives the demo countdown. */
export async function getHead(): Promise<bigint> {
  return publicClient.getBlockNumber()
}
