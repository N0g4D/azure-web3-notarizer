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
  return page.entities.map(toRecord)
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
