/**
 * Swarm integration via Swarm ID (@snaha/swarm-id): the document is encrypted
 * and uploaded to Swarm straight from the browser. Swarm ID signs postage
 * stamps client-side, so there is no Bee node to run.
 *
 * Zero Data Leakage: only encrypted bytes reach Swarm, and the plaintext file
 * never leaves the device.
 *
 * ⚠️ With `encrypt: true` the reference is 128 hex characters — 32 bytes of
 * address followed by 32 bytes of decryption key. The reference *is* the
 * secret: it must never be published to a public registry. Only the address
 * goes to Arkiv and to the chain (Phases 2 and 3), via `toPublicAddress`.
 */
import { SwarmIdClient } from '@snaha/swarm-id'
import type { ConnectionInfo, PostageBatch } from '@snaha/swarm-id'

export type { ConnectionInfo, PostageBatch }

/** Origin of the Swarm ID identity iframe (override when self-hosting). */
const SWARM_ID_ORIGIN =
  (import.meta.env.VITE_SWARM_ID_ORIGIN as string | undefined) ??
  'https://swarm-id.snaha.net'

/**
 * Optional subsidised gateway: lets users without a postage stamp upload
 * anyway, with the gateway doing the stamping server-side.
 */
const SWARM_GATEWAY_URL = import.meta.env.VITE_SWARM_GATEWAY_URL as
  | string
  | undefined

/** Swarm address length in hex: 32 bytes, key excluded. */
const SWARM_ADDRESS_HEX_LENGTH = 64

/** Swarm domain error, carrying messages ready for the UI. */
export class SwarmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwarmError'
  }
}

/**
 * Swarm ID client for Ancorhash. Create it once per session:
 * `initialize()` mounts a hidden iframe, `destroy()` tears it down.
 */
export function createSwarmClient(
  onConnectionChange: (info: ConnectionInfo) => void,
): SwarmIdClient {
  return new SwarmIdClient({
    iframeOrigin: SWARM_ID_ORIGIN,
    metadata: {
      name: 'Ancorhash',
      description: 'Confidential RWA Vault — encrypted documents on Swarm',
    },
    onConnectionChange,
    ...(SWARM_GATEWAY_URL ? { subsidisedGatewayUrl: SWARM_GATEWAY_URL } : {}),
  })
}

/**
 * State of the postage stamp actually attached to the connected identity.
 * `checked: false` means we do not know yet, not that none exists.
 */
export interface StampStatus {
  checked: boolean
  batch?: PostageBatch
  error?: string
}

export const UNKNOWN_STAMP: StampStatus = { checked: false }

/**
 * Queries the postage stamp of the connected identity.
 *
 * This exists because `canUpload` is not trustworthy: we saw it stay true for
 * an identity with no usable stamp, and the failure surfaced 30 seconds later
 * as an opaque timeout (swarm/friction.md S-02). `PostageBatch` carries
 * `exists` and `usable`, which are the truth.
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
          ? `Postage stamp status unreadable: ${error.message}`
          : 'Postage stamp status unreadable.',
    }
  }
}

/**
 * Why the user cannot upload. Null only when storage is genuinely usable.
 *
 * `canUpload` alone is NOT trusted: a batch must also exist and be usable. A
 * cautious "unavailable" beats a "Ready" that lies and only reveals the
 * problem 30 seconds into an upload.
 */
export function uploadUnavailableReason(
  info: ConnectionInfo,
  stamp: StampStatus = UNKNOWN_STAMP,
): string | null {
  if (!info.identity) return 'Connect Swarm ID to encrypt the document.'

  if (!info.canUpload) {
    if (info.uploadUnavailableReason === 'no-stamp') {
      return 'No postage stamp on your Swarm account: redeem a gift code to upload.'
    }
    if (info.uploadUnavailableReason === 'stamper-failed') {
      return 'Postage stamp signing failed: try again in a moment.'
    }
    return 'Swarm upload is not available for this account.'
  }

  // From here on canUpload is true, which is not enough.
  if (!stamp.checked) return 'Checking the postage stamp…'
  if (stamp.error) return stamp.error
  if (!stamp.batch || !stamp.batch.exists) {
    return 'Swarm ID reports ready but no postage stamp is present: without one the upload would time out.'
  }
  if (!stamp.batch.usable) {
    return 'The postage stamp exists but is not usable yet: wait a few blocks after redeeming.'
  }
  return null
}

/** Human-readable batch summary for the panel. */
export function describeStamp(batch: PostageBatch): string {
  const ttl =
    batch.batchTTL !== undefined && batch.batchTTL > 0
      ? `, expires in ~${Math.round(batch.batchTTL / 86_400)} d`
      : ''
  return `depth ${batch.depth}, utilisation ${batch.utilization}%${ttl}`
}

/**
 * Encrypts the file in the browser and uploads it to Swarm.
 * @returns the 128-hex encrypted reference — address + key, to be treated as
 *          a secret.
 */
export async function uploadEncrypted(
  client: SwarmIdClient,
  file: File,
  stamp: StampStatus,
  onProgress?: (percent: number) => void,
): Promise<string> {
  // The verified stamp is a required argument: with the UNKNOWN_STAMP default
  // this guard would always block, and that is deliberate. No upload starts
  // unless someone has actually looked at the batch.
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
        ? `Swarm upload failed: ${error.message}`
        : 'Swarm upload failed.',
    )
  }
}

/**
 * Public address extracted from an encrypted reference: the first 32 bytes,
 * without the decryption key. It is the only part that can be made public
 * (Arkiv, on-chain) without exposing the document's contents.
 */
export function toPublicAddress(reference: string): string {
  return reference.slice(0, SWARM_ADDRESS_HEX_LENGTH)
}
