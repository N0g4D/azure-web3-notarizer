/**
 * Integrazione Swarm tramite Swarm ID (@snaha/swarm-id): il documento viene
 * cifrato e caricato su Swarm direttamente dal browser. Swarm ID firma i
 * postage stamp lato client, quindi non c'è nessun Bee node da gestire.
 *
 * Pattern Zero Data Leakage: su Swarm finiscono solo byte cifrati e il file
 * in chiaro non lascia mai il dispositivo.
 *
 * ⚠️ Con `encrypt: true` la reference è di 128 caratteri hex — 32 byte di
 * indirizzo seguiti da 32 byte di chiave di decifratura. La reference *è* il
 * segreto: non va mai pubblicata su un registro pubblico. Verso Arkiv e la
 * blockchain (Fasi 2 e 3) va il solo indirizzo, via `toPublicAddress`.
 */
import { SwarmIdClient } from '@snaha/swarm-id'
import type { ConnectionInfo, PostageBatch } from '@snaha/swarm-id'

export type { ConnectionInfo, PostageBatch }

/** Origin dell'iframe di identità Swarm ID (override per self-hosting). */
const SWARM_ID_ORIGIN =
  (import.meta.env.VITE_SWARM_ID_ORIGIN as string | undefined) ??
  'https://swarm-id.snaha.net'

/**
 * Gateway sovvenzionato opzionale: permette l'upload agli utenti senza
 * postage stamp (è il gateway a mettere il francobollo lato server).
 */
const SWARM_GATEWAY_URL = import.meta.env.VITE_SWARM_GATEWAY_URL as
  | string
  | undefined

/** Lunghezza dell'indirizzo Swarm in hex: 32 byte, chiave esclusa. */
const SWARM_ADDRESS_HEX_LENGTH = 64

/** Errore di dominio Swarm, con messaggi già pronti per la UI. */
export class SwarmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwarmError'
  }
}

/**
 * Client Swarm ID per Ancorhash. Va creato una sola volta per sessione:
 * `initialize()` monta un iframe nascosto, `destroy()` lo smonta.
 */
export function createSwarmClient(
  onConnectionChange: (info: ConnectionInfo) => void,
): SwarmIdClient {
  return new SwarmIdClient({
    iframeOrigin: SWARM_ID_ORIGIN,
    metadata: {
      name: 'Ancorhash',
      description: 'Confidential RWA Vault — documenti cifrati su Swarm',
    },
    onConnectionChange,
    ...(SWARM_GATEWAY_URL ? { subsidisedGatewayUrl: SWARM_GATEWAY_URL } : {}),
  })
}

/**
 * Stato del postage stamp effettivamente associato all'identità connessa.
 * `checked: false` significa che non lo sappiamo ancora, non che manchi.
 */
export interface StampStatus {
  checked: boolean
  batch?: PostageBatch
  error?: string
}

export const UNKNOWN_STAMP: StampStatus = { checked: false }

/**
 * Interroga il postage stamp dell'identità connessa.
 *
 * Esiste perché `canUpload` non è affidabile: lo abbiamo visto restare true
 * con un'identità senza stamp utilizzabile, e il fallimento è arrivato 30
 * secondi dopo come timeout opaco (swarm/friction.md S-02). `PostageBatch`
 * porta `exists` e `usable`, che sono la verità.
 */
export async function fetchStampStatus(
  client: SwarmIdClient,
): Promise<StampStatus> {
  try {
    const batch = await client.getPostageBatch()
    return { checked: true, batch }
  } catch (error) {
    return {
      checked: true,
      error:
        error instanceof Error
          ? `Stato del postage stamp non leggibile: ${error.message}`
          : 'Stato del postage stamp non leggibile.',
    }
  }
}

/**
 * Perché l'utente non può caricare, in italiano. Null solo quando lo storage
 * è davvero utilizzabile.
 *
 * NON ci si fida del solo `canUpload`: serve anche un batch che esista e sia
 * usable. Meglio un "non disponibile" prudente che un "Pronto" che mente e
 * fa scoprire il problema 30 secondi dopo, a upload iniziato.
 */
export function uploadUnavailableReason(
  info: ConnectionInfo,
  stamp: StampStatus = UNKNOWN_STAMP,
): string | null {
  if (!info.identity) return 'Connetti Swarm ID per cifrare il documento.'

  if (!info.canUpload) {
    if (info.uploadUnavailableReason === 'no-stamp') {
      return 'Nessun postage stamp sul tuo account Swarm: riscatta un gift code per caricare.'
    }
    if (info.uploadUnavailableReason === 'stamper-failed') {
      return 'Firma del postage stamp fallita: riprova tra qualche istante.'
    }
    return 'Upload su Swarm non disponibile con questo account.'
  }

  // Da qui in poi canUpload è true, ma non basta.
  if (!stamp.checked) return 'Verifica del postage stamp in corso…'
  if (stamp.error) return stamp.error
  if (!stamp.batch || !stamp.batch.exists) {
    return 'Swarm ID si dichiara pronto ma non risulta alcun postage stamp: senza stamp l\'upload andrebbe in timeout.'
  }
  if (!stamp.batch.usable) {
    return 'Il postage stamp esiste ma non è ancora utilizzabile: attendi qualche blocco dopo il riscatto.'
  }
  return null
}

/** Riassunto leggibile del batch per il pannello. */
export function describeStamp(batch: PostageBatch): string {
  const ttl =
    batch.batchTTL !== undefined && batch.batchTTL > 0
      ? `, scade tra ~${Math.round(batch.batchTTL / 86_400)} g`
      : ''
  return `depth ${batch.depth}, utilizzo ${batch.utilization}%${ttl}`
}

/**
 * Cifra il file nel browser e lo carica su Swarm.
 * @returns la reference cifrata di 128 hex — indirizzo + chiave, da trattare
 *          come un segreto.
 */
export async function uploadEncrypted(
  client: SwarmIdClient,
  file: File,
  stamp: StampStatus,
  onProgress?: (percent: number) => void,
): Promise<string> {
  // Lo stamp verificato è un parametro obbligatorio: con il default
  // UNKNOWN_STAMP questa guardia bloccherebbe sempre, ed è voluto. Nessun
  // upload parte senza che qualcuno abbia davvero guardato il batch.
  const blocked = uploadUnavailableReason(client.connectionInfo, stamp)
  if (blocked !== null) throw new SwarmError(blocked)

  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    const result = await client.uploadData(bytes, {
      encrypt: true,
      useWorkers: true,
      onProgress: onProgress
        ? ({ total, processed }) =>
            onProgress(total > 0 ? Math.round((processed / total) * 100) : 0)
        : undefined,
    })
    return result.reference
  } catch (error) {
    throw new SwarmError(
      error instanceof Error
        ? `Upload su Swarm fallito: ${error.message}`
        : 'Upload su Swarm fallito.',
    )
  }
}

/**
 * Indirizzo pubblico estratto da una reference cifrata: i primi 32 byte,
 * senza la chiave di decifratura. È l'unica parte che può essere resa
 * pubblica (Arkiv, on-chain) senza esporre il contenuto del documento.
 */
export function toPublicAddress(reference: string): string {
  return reference.slice(0, SWARM_ADDRESS_HEX_LENGTH)
}
