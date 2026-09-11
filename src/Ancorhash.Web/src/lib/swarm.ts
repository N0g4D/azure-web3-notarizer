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
import type { ConnectionInfo } from '@snaha/swarm-id'

export type { ConnectionInfo }

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
 * Perché l'utente non può caricare, in italiano. Un'identità connessa non
 * basta: senza postage stamp e senza gateway sovvenzionato `canUpload` è
 * false, ed è il caso più frequente prima di riscattare un gift code.
 */
export function uploadUnavailableReason(info: ConnectionInfo): string | null {
  if (!info.identity) return 'Connetti Swarm ID per cifrare il documento.'
  if (info.canUpload) return null
  if (info.uploadUnavailableReason === 'no-stamp') {
    return 'Nessun postage stamp sul tuo account Swarm: riscatta un gift code per caricare.'
  }
  if (info.uploadUnavailableReason === 'stamper-failed') {
    return 'Firma del postage stamp fallita: riprova tra qualche istante.'
  }
  return 'Upload su Swarm non disponibile con questo account.'
}

/**
 * Cifra il file nel browser e lo carica su Swarm.
 * @returns la reference cifrata di 128 hex — indirizzo + chiave, da trattare
 *          come un segreto.
 */
export async function uploadEncrypted(
  client: SwarmIdClient,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const blocked = uploadUnavailableReason(client.connectionInfo)
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
