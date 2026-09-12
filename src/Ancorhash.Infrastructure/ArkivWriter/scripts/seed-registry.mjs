/**
 * Seeds the public registry with a handful of records so the auditor view has
 * something to show. Reproducible on purpose: every document digest is the
 * SHA-256 of a published string, so anyone can recompute it and check that the
 * register is not fabricated.
 *
 *   ARKIV_PRIVATE_KEY=0x... ARKIV_RPC_URL=... node scripts/seed-registry.mjs
 *
 * Writes real transactions to Tiramisu. Each record needs test GLM.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WRITER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'write-entity.mjs')

const DAY = 86_400
const ANCHOR_TX = '0x039f85a41057619ba274a8212d50b95accd50c2187e48dcceff82e5ec0b3963e'

/** Swarm address of the encrypted blob. A commitment, never the key. */
const SWARM = '959daf94110f4e2ec69c1ebd7a5182489d3f06aa1384e215b4cf859822a4cfe8'

const RECORDS = [
  { text: 'Ancorhash ETHRome 2026 demo invoice', org: 'acme-spa', type: 'invoice', days: 7 },
  { text: 'Ancorhash demo supply contract 2026', org: 'acme-spa', type: 'contract', days: 7 },
  { text: 'Ancorhash demo delivery note 4471', org: 'acme-spa', type: 'delivery-note', days: 7 },
  { text: 'Ancorhash demo invoice NW-2026-118', org: 'nordwind-gmbh', type: 'invoice', days: 7 },
  // Short-lived on purpose: gives the "lapsing within 24 h" filter something
  // to discriminate, and still outlives a judging session.
  { text: 'Ancorhash demo bank statement Q3', org: 'acme-spa', type: 'bank-statement', hours: 6 },
]

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

function write(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRITER], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.on('close', () => {
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error(`writer output unparseable: ${out.slice(0, 200)}`))
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

for (const r of RECORDS) {
  const hash = sha256(r.text)
  const seconds = r.hours ? r.hours * 3600 : r.days * DAY
  const result = await write({
    document_id: `${r.type}.pdf`,
    document_hash: hash,
    swarm_address: SWARM,
    expiration_seconds: seconds,
    chain_id: 43113,
    tx_hash: ANCHOR_TX,
    anchor_chain: 'Avalanche Fuji C-Chain',
    explorer_url: `https://testnet.snowtrace.io/tx/${ANCHOR_TX}`,
    org: r.org,
    doc_type: r.type,
  })
  const label = `${r.org}/${r.type}`.padEnd(30)
  if (result.ok) {
    console.log(`  ok    ${label} ${hash.slice(0, 12)}… exp block ${result.expires_at_block}`)
  } else {
    console.log(`  FAIL  ${label} [${result.code}] ${result.error}`)
  }
}
console.log('\nDigests are SHA-256 of the published strings in this file.')
