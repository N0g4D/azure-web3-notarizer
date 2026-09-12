/**
 * Deriva l'indirizzo del creatore delle entità Arkiv dalla chiave privata del
 * writer, e lo confronta con quello configurato nel frontend.
 *
 * Esiste perché i due runtime condividono questo valore: il backend ha la
 * chiave, il frontend solo l'indirizzo. Se divergono, ogni query si ancora al
 * creatore sbagliato e non torna NULLA, senza errori. Meglio scoprirlo qui.
 *
 *   cd src/Ancorhash.Web
 *   ARKIV_PRIVATE_KEY=0x... npm run arkiv:creator
 */
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'

const key = process.env.ARKIV_PRIVATE_KEY
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('ARKIV_PRIVATE_KEY assente o malformata.')
  process.exit(1)
}
const address = privateKeyToAccount(key).address
console.log('indirizzo creatore Arkiv:', address)

try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const m = env.match(/^VITE_ARKIV_CREATOR_ADDRESS\s*=\s*"?([^"\n]*)"?/m)
  const configured = (m?.[1] ?? '').trim()
  if (!configured) {
    console.log('\nDa mettere in src/Ancorhash.Web/.env:')
    console.log(`VITE_ARKIV_CREATOR_ADDRESS="${address}"`)
  } else if (configured.toLowerCase() !== address.toLowerCase()) {
    console.error(`\n!!! DISALLINEAMENTO !!!`)
    console.error(`  frontend: ${configured}`)
    console.error(`  chiave  : ${address}`)
    console.error('Ogni query si ancorerebbe al creatore sbagliato e non troverebbe nulla.')
    process.exit(1)
  } else {
    console.log('frontend allineato.')
  }
} catch {
  console.log('(.env del frontend non leggibile: salto il confronto)')
}
