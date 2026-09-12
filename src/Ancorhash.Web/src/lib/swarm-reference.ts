/**
 * Pure reference handling: no SDK, no network, no browser globals.
 *
 * Split out of `swarm.ts` deliberately. That module imports the Swarm ID SDK,
 * which pulls in axios and touches `window` at import time — so anything
 * living there cannot be unit-tested under Node. These two functions encode
 * the security invariant of the whole product, so they are exactly what must
 * be covered by tests.
 *
 * The invariant: 64 hex is the chunk ADDRESS, published in the registry and
 * unable to open anything. 128 hex is address + DECRYPTION KEY, which is why
 * it never leaves the browser.
 */

/** Swarm address: 32 bytes, key excluded. */
export const SWARM_ADDRESS_HEX_LENGTH = 64
/** Full encrypted reference: address + decryption key. */
export const SWARM_REFERENCE_HEX_LENGTH = 128

/**
 * Public Swarm gateway used to retrieve a document. Override for a private
 * gateway or a self-hosted Bee node.
 */
const SWARM_GATEWAY_READ_URL =
  (import.meta.env.VITE_SWARM_READ_GATEWAY as string | undefined) ??
  'https://gateway.ethswarm.org'

/** What a pasted value is, so the UI can explain rather than just refuse. */
export type ReferenceShape =
  | { kind: 'reference'; value: string }
  | { kind: 'address-only'; value: string }
  | { kind: 'invalid'; reason: string }

/**
 * Classifies a pasted hex value.
 *
 * A 64-hex address gets its own outcome rather than being lumped in with
 * garbage: it is exactly what the registry publishes, and the point worth
 * making is that it is not enough to read anything.
 */
export function classifyReference(input: string): ReferenceShape {
  const clean = input.trim().toLowerCase().replace(/^0x/, '')
  if (clean === '') return { kind: 'invalid', reason: 'Enter a Swarm reference.' }
  if (!/^[0-9a-f]+$/.test(clean)) {
    return { kind: 'invalid', reason: 'A Swarm reference is hexadecimal only.' }
  }
  if (clean.length === SWARM_REFERENCE_HEX_LENGTH) {
    return { kind: 'reference', value: clean }
  }
  if (clean.length === SWARM_ADDRESS_HEX_LENGTH) {
    return { kind: 'address-only', value: clean }
  }
  return {
    kind: 'invalid',
    reason: `A full reference is ${SWARM_REFERENCE_HEX_LENGTH} hex characters; this is ${clean.length}.`,
  }
}

/**
 * Builds the retrieval URL for a full 128-hex reference.
 *
 * The gateway decrypts using the key carried in the second half: the address
 * alone identifies the chunk but cannot open it. That is precisely why the
 * registry stores only 64 hex — a public index must never hold anything that
 * decrypts anything.
 *
 * The reference is never sent to Ancorhash. It goes from this page straight to
 * the gateway, and it is never logged.
 */
export function toGatewayUrl(reference: string): string {
  const shape = classifyReference(reference)
  if (shape.kind !== 'reference') {
    throw new Error(
      shape.kind === 'address-only'
        ? 'That is a 64-hex address, not a full reference: it cannot decrypt.'
        : shape.reason,
    )
  }
  return `${SWARM_GATEWAY_READ_URL}/bzz/${shape.value}/`
}

/**
 * Size of the gateway's own HTML shell, which it serves with HTTP 200 for any
 * address it cannot resolve — including all-zeroes. Measured 2026-09-13.
 */
const GATEWAY_SHELL_CONTENT_TYPE = 'text/html'

export type RetrievalProbe =
  | { ok: true; contentType: string; bytes: number }
  | { ok: false; reason: string }

/**
 * Checks that a reference actually resolves, before opening a tab.
 *
 * Necessary because the public gateway answers **HTTP 200 with its own HTML
 * shell** for any unresolvable address — a wrong reference and a real document
 * are indistinguishable by status code. Opening blindly would show a viewer an
 * anonymous error page and look like the product is broken.
 *
 * A real document comes back with its own content type; the gateway's failure
 * shell is always text/html. That is the only signal available, so an HTML
 * document is reported as unresolved — with the caveat that a genuinely
 * HTML-typed upload would be misreported, which is a trade worth making when
 * the alternative is silence.
 *
 * The reference goes straight to the gateway and is never logged or sent to
 * Ancorhash.
 */
export async function probeReference(reference: string): Promise<RetrievalProbe> {
  let url: string
  try {
    url = toGatewayUrl(reference)
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
  try {
    const response = await fetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      return { ok: false, reason: `Gateway returned HTTP ${response.status}.` }
    }
    if (contentType.startsWith(GATEWAY_SHELL_CONTENT_TYPE)) {
      return {
        ok: false,
        reason:
          'The gateway could not resolve this reference. It answers 200 with its ' +
          'own page for anything it cannot find, so this is what a wrong or ' +
          'expired reference looks like.',
      }
    }
    const bytes = (await response.arrayBuffer()).byteLength
    return { ok: true, contentType, bytes }
  } catch {
    return { ok: false, reason: 'Could not reach the Swarm gateway.' }
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
