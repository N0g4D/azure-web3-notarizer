/**
 * Seeds the public registry with sample records for the AML remediation
 * scenario.
 *
 * These are SAMPLE RECORDS, NOT MOCK DATA: every one is a real Arkiv entity,
 * signed by the relayer and live on the public Tiramisu index. Only the
 * organisation names are fictional. Reproducible on purpose too — every
 * document digest is the SHA-256 of a published string, so anyone can
 * recompute it and check the register was not fabricated.
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
  // One consultancy running an AML remediation batch for a bank, plus a second
  // client. Organisation names are fictional; the entities are real, written to
  // the public Arkiv index by the relayer and readable by anyone.
  //
  // Retention windows are deliberate, not decorative. AML record-keeping runs
  // 5 years from the end of the customer relationship under EU AMLD, and several
  // jurisdictions require longer, so:
  //   1825 d = 5 years   (the AMLD floor)
  //   2555 d = 7 years   (common internal policy, a margin over the floor)
  //   3650 d = 10 years  (the longest national requirement in scope)
  // The index entry lapses when the obligation does. Nothing deletes it.

  // The reproducible one: its digest is also the Fuji token id, so a judge can
  // recompute sha256 of this exact string and find the same value on Arkiv,
  // on Swarm as a commitment, and on Avalanche as a token.
  { text: 'Ancorhash ETHRome 2026 demo invoice',
    org: 'northbank-plc',  type: 'invoice',         days: 1825 },

  { text: 'Northbank KYC remediation - account statement 2021-Q3',
    org: 'northbank-plc',  type: 'bank-statement',  days: 1825 },

  { text: 'Northbank KYC remediation - customer agreement 2019',
    org: 'northbank-plc',  type: 'contract',        days: 3650 },

  { text: 'Meridian Trust KYC remediation - account statement 2022-Q1',
    org: 'meridian-trust', type: 'bank-statement',  days: 2555 },

  // Short-lived on purpose: the Mission 02 demonstration. Gives the
  // "lapsing within 24 h" filter something to discriminate, and outlives a
  // judging session.
  { text: 'Ancorhash retention window demonstration',
    org: 'northbank-plc',  type: 'retention-demo',  hours: 6 },
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
