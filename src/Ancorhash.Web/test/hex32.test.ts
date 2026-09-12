/**
 * Round-trip hex <-> bytes32 fra i DUE runtime.
 *
 * Il backend scrive l'entità dal writer Node, il frontend la interroga. Se le
 * due conversioni divergono anche solo per il case, la query non trova nulla
 * E NON DÀ ERRORE: su Arkiv un valore che non combacia restituisce zero
 * risultati in silenzio (official/typescript-sdk/querying-data: "a type
 * mismatch is not an error: the query runs and returns nothing").
 *
 * Questo test importa la funzione VERA di entrambi i lati — non una copia
 * scritta qui — così se una delle due cambia, il test si accorge.
 */
import { describe, expect, it } from 'vitest'
import { toHex32 as frontendToHex32 } from '../src/lib/arkiv'
// @ts-expect-error — il writer è JS puro, senza typings
import { toHex32 as writerToHex32 } from '../../Ancorhash.Infrastructure/ArkivWriter/src/write-entity.mjs'

const CASES = [
  '3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a3f2a',
  '7689dba7500b7ba30d3b06eafcca9810a95f5cc627cbd7f4cad6d8047ac15880',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '0000000000000000000000000000000000000000000000000000000000000000',
  // maiuscolo: entrambi devono normalizzare a minuscolo
  '3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A3F2A',
  // maiuscole e minuscole mescolate
  'AbCdEf0123456789aBcDeF0123456789AbCdEf0123456789aBcDeF0123456789',
]

describe('conversione hex -> bytes32, identica sui due runtime', () => {
  it.each(CASES)('coincide per %s', (input) => {
    const fromFrontend = frontendToHex32(input)
    const fromWriter = writerToHex32(input, 'document_hash')
    expect(fromFrontend).toBe(fromWriter)
  })

  it('normalizza sempre a 0x + 64 hex minuscoli', () => {
    for (const input of CASES) {
      const out = frontendToHex32(input)
      expect(out).toMatch(/^0x[0-9a-f]{64}$/)
      expect(out).toBe(`0x${input.toLowerCase()}`)
    }
  })

  it('il round-trip preserva il valore', () => {
    for (const input of CASES) {
      const hex = frontendToHex32(input)
      expect(hex.slice(2)).toBe(input.toLowerCase())
    }
  })

  it('rifiuta una reference completa di 128 hex su entrambi i lati', () => {
    const full = 'a'.repeat(128)
    expect(() => frontendToHex32(full)).toThrow()
    expect(() => writerToHex32(full, 'swarm_address')).toThrow()
  })

  it('rifiuta lunghezze sbagliate e caratteri non hex', () => {
    for (const bad of ['', 'zz', 'a'.repeat(63), 'a'.repeat(65), `0x${'a'.repeat(64)}`]) {
      expect(() => frontendToHex32(bad)).toThrow()
      expect(() => writerToHex32(bad, 'x')).toThrow()
    }
  })
})
