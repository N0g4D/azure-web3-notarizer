/** Client tipizzato per il backend Ancorhash (Azure Functions .NET). */

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:7071'

export interface NotarizeRequest {
  document_id: string
  /** Impronta SHA-256 del documento in chiaro: l'ancora di integrità. */
  document_hash: string
  /**
   * Reference Swarm del documento cifrato. Va inviato l'indirizzo pubblico
   * (64 hex) e mai la reference completa di 128 hex, che include la chiave
   * di decifratura: vedi `toPublicAddress` in lib/swarm.ts.
   */
  swarm_reference: string
  /**
   * Durata di validità del record, in secondi. L'unità è esplicita nel nome
   * perché la Fase 2 la traduce in una scadenza Arkiv, dove sbagliare unità
   * significa un'entità che non scade mai (o che scade subito).
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
    let detail = `Errore ${response.status} dal backend.`
    try {
      const body = (await response.json()) as ApiErrorResponse
      if (body.detail) detail = body.detail
    } catch {
      // body non JSON: teniamo il messaggio generico
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

/** Reti EVM configurate sul relayer (solo chain_id e nome, mai RPC URL). */
export async function getChains(): Promise<Chain[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/chains`)
  const body = await parseOrThrow<ChainsResponse>(response)
  return body.chains
}
