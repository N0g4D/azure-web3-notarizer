/**
 * Pure reference handling: no SDK, no network, no browser globals.
 *
 * Split out of `swarm.ts` deliberately. That module imports the Swarm ID SDK,
 * which pulls in axios and touches `window` at import time — so anything
 * living there cannot be unit-tested under Node. These functions encode the
 * security invariant of the whole product, so they are exactly what must be
 * covered by tests.
 *
 * The invariant: 64 hex is the chunk ADDRESS, published in the registry and
 * unable to open anything. 128 hex is address + DECRYPTION KEY, which is why
 * it never leaves the browser.
 *
 * Retrieval itself is NOT here, and not a URL either: it needs the Swarm ID
 * client, which downloads the encrypted chunks and decrypts them in the
 * browser (`downloadDecrypted` in `swarm.ts`).
 */

/** Swarm address: 32 bytes, key excluded. */
export const SWARM_ADDRESS_HEX_LENGTH = 64
/** Full encrypted reference: address + decryption key. */
export const SWARM_REFERENCE_HEX_LENGTH = 128

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
 * Public address extracted from an encrypted reference: the first 32 bytes,
 * without the decryption key. It is the only part that can be made public
 * (Arkiv, on-chain) without exposing the document's contents.
 */
export function toPublicAddress(reference: string): string {
  return reference.slice(0, SWARM_ADDRESS_HEX_LENGTH)
}
