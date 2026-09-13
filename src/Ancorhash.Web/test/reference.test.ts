/**
 * The 64/128 distinction is the security invariant, so it is pinned by tests.
 *
 * Imported from `swarm-reference` rather than `swarm`: the latter pulls in the
 * Swarm ID SDK, which touches `window` at import time and cannot load under
 * Node. Splitting the pure logic out is what makes it testable at all.
 *
 * 64 hex is the address the registry publishes: it identifies the chunk and
 * cannot open it. 128 hex is address + decryption key, which is why it never
 * leaves the browser. A regression that blurred the two would either break
 * retrieval or, far worse, make a 64-hex value look sufficient to decrypt.
 */
import { describe, expect, it } from 'vitest'
import { classifyReference, toPublicAddress } from '../src/lib/swarm-reference'

const ADDRESS = 'a'.repeat(64)
const REFERENCE = 'b'.repeat(64) + 'c'.repeat(64)

describe('classifyReference', () => {
  it('accepts a 128-hex reference', () => {
    expect(classifyReference(REFERENCE)).toEqual({ kind: 'reference', value: REFERENCE })
  })

  it('flags a 64-hex address as address-only, not invalid', () => {
    // The UI must explain why this cannot work, not just refuse it.
    expect(classifyReference(ADDRESS)).toEqual({ kind: 'address-only', value: ADDRESS })
  })

  it('tolerates 0x, whitespace and uppercase', () => {
    const r = classifyReference(`  0x${REFERENCE.toUpperCase()}  `)
    expect(r).toEqual({ kind: 'reference', value: REFERENCE })
  })

  it('rejects non-hex and wrong lengths', () => {
    expect(classifyReference('').kind).toBe('invalid')
    expect(classifyReference('zz'.repeat(64)).kind).toBe('invalid')
    expect(classifyReference('a'.repeat(127)).kind).toBe('invalid')
    expect(classifyReference('a'.repeat(129)).kind).toBe('invalid')
  })
})

describe('address and reference stay distinct', () => {
  it('toPublicAddress keeps the first half and drops the key', () => {
    const address = toPublicAddress(REFERENCE)
    expect(address).toHaveLength(64)
    expect(address).toBe('b'.repeat(64))
    // The published half must not contain any of the key half.
    expect(REFERENCE.slice(64)).toBe('c'.repeat(64))
    expect(address).not.toContain('c')
  })

  it('the published address is never classified as retrievable', () => {
    // `downloadDecrypted` gates on exactly this: anything that is not
    // `kind: 'reference'` is refused before the network is touched, so the
    // half of the reference that Arkiv publishes can never trigger a fetch.
    expect(classifyReference(toPublicAddress(REFERENCE)).kind).toBe('address-only')
  })
})
