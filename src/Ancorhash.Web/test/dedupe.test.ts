/**
 * The register must show one row per document.
 *
 * Duplicates are a legitimate state, not corruption: the chain enforces one
 * token per document, Arkiv enforces nothing, so re-indexing after a failed
 * write (`arkiv_indexed: false`) or after a lapse leaves two entities for one
 * document. Keeping the wrong one would show an auditor a record that has
 * already expired while a live one exists.
 */
import { describe, expect, it } from 'vitest'
import { dedupeByDocument } from '../src/lib/arkiv'
import type { NotarizationRecord } from '../src/lib/arkiv'

const record = (
  entityKey: string,
  documentHash: string,
  expiresAtBlock: bigint,
): NotarizationRecord => ({ entityKey, documentHash, expiresAtBlock })

describe('dedupeByDocument', () => {
  it('keeps the longest-lived entity for a document', () => {
    const out = dedupeByDocument([
      record('0xold', '0xdoc', 100n),
      record('0xnew', '0xdoc', 900n),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].entityKey).toBe('0xnew')
  })

  it('is independent of input order', () => {
    const a = dedupeByDocument([
      record('0xnew', '0xdoc', 900n),
      record('0xold', '0xdoc', 100n),
    ])
    expect(a).toHaveLength(1)
    expect(a[0].entityKey).toBe('0xnew')
  })

  it('leaves distinct documents alone', () => {
    const out = dedupeByDocument([
      record('0xa', '0xdoc1', 100n),
      record('0xb', '0xdoc2', 100n),
    ])
    expect(out).toHaveLength(2)
  })

  it('falls back to the entity key when a digest is missing', () => {
    const out = dedupeByDocument([
      { entityKey: '0xa', expiresAtBlock: 1n },
      { entityKey: '0xb', expiresAtBlock: 1n },
    ])
    expect(out).toHaveLength(2)
  })

  it('compares as bigint, not as a string', () => {
    // '100' > '90' lexicographically, so a string compare would pick the
    // shorter-lived record here.
    const out = dedupeByDocument([
      record('0xshort', '0xdoc', 100n),
      record('0xlong', '0xdoc', 90_000n),
    ])
    expect(out[0].entityKey).toBe('0xlong')
  })
})
