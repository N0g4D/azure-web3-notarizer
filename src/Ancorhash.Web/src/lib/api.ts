/** Client tipizzato per il backend Ancorhash (Azure Functions .NET). */

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:7071'

export interface NotarizeRequest {
  document_id: string
  document_hash: string
  wallet_address: string
  chain_id: number
}

export interface NotarizeResponse {
  status: string
  document_id: string
  doc_hash: string
  tx_hash: string
  chain_id: number
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

export async function notarize(
  payload: NotarizeRequest,
): Promise<NotarizeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/notarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

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

  return (await response.json()) as NotarizeResponse
}
