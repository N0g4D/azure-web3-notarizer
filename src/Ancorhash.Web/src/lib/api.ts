/** Typed client for the Ancorhash backend (Azure Functions .NET). */

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:7071'

export interface NotarizeRequest {
  document_id: string
  /** SHA-256 digest of the document: the integrity anchor. */
  document_hash: string
  /**
   * PUBLIC Swarm address of the encrypted document: 64 hex characters.
   * This is not the full 128-hex reference, which embeds the decryption key —
   * see `toPublicAddress` in lib/swarm.ts. The field is named "address"
   * precisely so it does not invite that mistake.
   */
  swarm_address: string
  /**
   * Record lifetime, in seconds. The unit is explicit in the name because
   * Phase 2 translates it into an Arkiv expiry, where getting the unit wrong
   * means an entity that never expires (or one that expires immediately).
   */
  expiration_seconds: number
  wallet_address: string
  chain_id: number
  turnstile_token: string
}

export interface NotarizeResponse {
  status: string
  document_id: string
  doc_hash: string
  tx_hash: string
  chain_id: number
  /** Arkiv entity key. Empty when indexing failed. */
  arkiv_entity_key: string
  /** Block the entity expires at. A string, because it is a uint64. */
  arkiv_expires_at_block: string
  /**
   * False when the on-chain anchor succeeded but the Arkiv write did not.
   * The notarization is still valid: the proof is the transaction.
   */
  arkiv_indexed: boolean
  /** Machine-readable failure code (writer_not_found, missing_key, …). */
  arkiv_error_code?: string
  /** Human-readable reason: tells "write failed" apart from "entity expired". */
  arkiv_error?: string
}

export interface Chain {
  chain_id: number
  name: string
  estimated_cost_usd: number
  is_free: boolean
}

interface ChainsResponse {
  status: string
  chains: Chain[]
}

interface ApiErrorResponse {
  status: string
  detail: string
}

export class ApiError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.statusCode = statusCode
  }
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `Error ${response.status} from the backend.`
    try {
      const body = (await response.json()) as ApiErrorResponse
      if (body.detail) detail = body.detail
    } catch {
      // Non-JSON body: keep the generic message.
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

export async function notarize(
  payload: NotarizeRequest,
): Promise<NotarizeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/notarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseOrThrow<NotarizeResponse>(response)
}

/** EVM networks configured on the relayer (chain id and name only, never RPC URLs). */
export async function getChains(): Promise<Chain[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/chains`)
  const body = await parseOrThrow<ChainsResponse>(response)
  return body.chains
}
