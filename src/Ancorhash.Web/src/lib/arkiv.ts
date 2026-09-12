/**
 * Percorso di LETTURA di Arkiv: query dell'indice pubblico direttamente dal
 * browser. Architettura ibrida (a.txt B5): le scritture le firma il relayer
 * lato server, le letture girano qui.
 *
 * Il public client non firma nulla e non ha bisogno di chiavi, quindi è sicuro
 * nel bundle. L'ACCESS KEY NON VA MESSA QUI: finirebbe nelle richieste di rete
 * di chiunque apra la pagina. Il frontend usa l'RPC pubblico rate-limited.
 */
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { bytes32, str, u64 } from '@arkiv-network/sdk/attr'
import { eq, gte, lt } from '@arkiv-network/sdk/query'
import { http } from 'viem'

/** Deve restare allineato a SCHEMA_VERSION del writer (arkiv/schema.md §2). */
export const SCHEMA_VERSION = 1

/**
 * Wallet che FIRMA le entità Arkiv. Configurazione condivisa fra i due
 * runtime: il backend possiede la chiave, il frontend solo l'indirizzo.
 *
 * Serve perché ogni query si ancora a createdBy(). `app: "ancorhash"` è una
 * stringa che chiunque può copiare sulle proprie entità; `$creator` no, non è
 * falsificabile. Senza questa ancora un terzo potrebbe iniettare entità che la
 * nostra UI mostrerebbe come autentiche.
 */
export const ARKIV_CREATOR_ADDRESS = import.meta.env
  .VITE_ARKIV_CREATOR_ADDRESS as `0x${string}` | undefined

/** RPC Tiramisu. Vuoto = endpoint pubblico di default. */
const ARKIV_RPC_URL = import.meta.env.VITE_ARKIV_RPC_URL as string | undefined

export const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(ARKIV_RPC_URL || undefined),
})

/**
 * 64 hex senza prefisso -> Hex `0x` minuscolo.
 *
 * DEVE produrre esattamente la stessa forma di `toHex32` nel writer Node.
 * Un disallineamento non dà errore: su Arkiv un valore che non combacia
 * restituisce semplicemente zero risultati, in silenzio. È il tipo di bug che
 * si scopre in demo. Il test cross-runtime in `test/hex32.test.ts` confronta
 * le due implementazioni eseguendole entrambe.
 */
export function toHex32(value: string): `0x${string}` {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `Atteso un valore di 64 caratteri hex senza 0x, ricevuti ${value.length}.`,
    )
  }
  return `0x${value.toLowerCase()}` as `0x${string}`
}

/** Ancora comune a ogni query: namespace + tipo + creatore verificabile. */
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
 * Q1 di schema.md §7 — questo documento è già notarizzato da noi?
 * È anche la query che prova la Mission 02: prima della scadenza torna
 * l'entità, dopo non torna nulla, senza alcuna chiamata di Delete.
 */
export async function findByDocumentHash(
  documentHash: string,
): Promise<NotarizationRecord[]> {
  const page = await anchored()
    .where(eq('document_hash', bytes32(toHex32(documentHash))))
    .fetch()
  return page.entities.map(toRecord)
}

/** Q2 — record di un'organizzazione in una finestra temporale. */
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

/** Q3 — cosa scade entro N blocchi. Filtra sull'attributo di sistema $expiresAt. */
export async function findExpiringWithin(
  blocks: bigint,
): Promise<{ head: bigint; records: NotarizationRecord[] }> {
  const head = await publicClient.getBlockNumber()
  const page = await anchored()
    .where(lt('$expiresAt', u64(head + blocks)))
    .fetch()
  return { head, records: page.entities.map(toRecord) }
}

/** Altezza corrente della catena: serve al conto alla rovescia della demo. */
export async function getHead(): Promise<bigint> {
  return publicClient.getBlockNumber()
}
