/**
 * Ponte Node -> Arkiv per Ancorhash.
 *
 * Esiste perché l'SDK Arkiv non ha una versione .NET (friction.md F-07).
 * Il backend C# invoca questo script come processo figlio, gli passa un JSON
 * su STDIN e ne rilegge un JSON su STDOUT.
 *
 * STDIN  (JSON):
 *   document_id        string   obbligatorio
 *   document_hash      string   64 hex, senza 0x  (SHA-256 del documento)
 *   swarm_address      string   64 hex, senza 0x  (INDIRIZZO pubblico Swarm)
 *   expiration_seconds number   validità del record
 *   chain_id           number   chain EIP-155 di ancoraggio
 *   org                string   opzionale, slug
 *   doc_type           string   opzionale, slug
 *   tx_hash            string   opzionale (assente se Arkiv gira prima del relayer)
 *   anchor_chain       string   opzionale
 *   explorer_url       string   opzionale
 *   description        string   opzionale
 *
 * STDOUT (JSON): { ok, entity_key, tx_hash, expires_at_block, lifetime_blocks }
 *                oppure { ok: false, error, code }
 *
 * ⚠️ INVARIANTE: su Arkiv non finisce MAI la chiave di decifratura Swarm.
 * La reference cifrata è di 128 hex = 32 byte di indirizzo + 32 byte di
 * chiave. Qui arriva solo la prima metà. Il payload NON è confidenziale:
 * è leggibile da chiunque con select({ payload: true }).
 */
import { createWalletClient, ExpirationTime, jsonToPayload } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { bytes32, i32, str, u64 } from "@arkiv-network/sdk/attr"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

/** Block time nominale di Tiramisu. Non è un orologio: vedi schema.md §5. */
const BLOCK_TIME_SECONDS = 2
/** Versione dello schema delle entità (arkiv/schema.md). */
const SCHEMA_VERSION = 1

const HEX64 = /^[0-9a-fA-F]{64}$/
const HEX128 = /^[0-9a-fA-F]{128}$/

class WriterError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (c) => {
      buf += c
      // Un input mostruoso è un errore di chiamata, non un caso d'uso.
      if (buf.length > 256_000) reject(new WriterError("input_too_large", "STDIN oltre 256 KB."))
    })
    process.stdin.on("end", () => resolve(buf))
    process.stdin.on("error", reject)
  })
}

/** 64 hex senza prefisso -> Hex 0x, che è ciò che bytes32() accetta. */
function toHex32(value, field) {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw new WriterError("invalid_hex", `${field} deve essere di 64 caratteri hex senza 0x.`)
  }
  return `0x${value.toLowerCase()}`
}

/**
 * Difesa in profondità: se un qualsiasi campo porta 128 hex, qualcuno sta per
 * pubblicare una chiave di decifratura su un indice pubblico e permanente.
 * Si abortisce prima di toccare la rete.
 */
function assertNoFullReference(input) {
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && HEX128.test(v.replace(/^0x/, ""))) {
      throw new WriterError(
        "secret_leak_blocked",
        `Il campo "${k}" contiene 128 caratteri hex: è la reference Swarm completa e ` +
          `include la chiave di decifratura. Su Arkiv va solo l'indirizzo (64 hex).`,
      )
    }
  }
}

/** Slug corto e prevedibile per gli attributi str; str() rifiuta i control char. */
function slug(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") return fallback
  const s = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 128)
  return s === "" ? fallback : s
}

async function main() {
  const raw = await readStdin()
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    throw new WriterError("invalid_json", "STDIN non è JSON valido.")
  }

  assertNoFullReference(input)

  const privateKey = process.env.ARKIV_PRIVATE_KEY
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new WriterError(
      "missing_key",
      "ARKIV_PRIVATE_KEY assente o malformata. Va nel .env locale, mai nel codice.",
    )
  }

  const documentHash = toHex32(input.document_hash, "document_hash")
  const swarmAddress = toHex32(input.swarm_address, "swarm_address")

  const expirationSeconds = Number(input.expiration_seconds)
  if (!Number.isFinite(expirationSeconds) || expirationSeconds <= 0) {
    throw new WriterError("invalid_expiration", "expiration_seconds deve essere un numero positivo.")
  }

  // Mission 02. Si ragiona in BLOCCHI, non in secondi: Tiramisu non promette
  // il wall-clock (schema.md §5), quindi si usa fromBlocks(), l'unica forma
  // senza conversione. ceil -> la vita è "almeno" quella richiesta.
  const lifetimeBlocks = Math.ceil(expirationSeconds / BLOCK_TIME_SECONDS)

  const chainId = Number(input.chain_id)
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new WriterError("invalid_chain_id", "chain_id deve essere un intero positivo.")
  }

  const account = privateKeyToAccount(privateKey)
  const walletClient = createWalletClient({
    chain: tiramisu,
    // Con URL vuoto si usa l'RPC pubblico di tiramisu, fortemente rate-limited.
    // L'access key sta lato server, mai nel frontend.
    transport: http(process.env.ARKIV_RPC_URL || undefined),
    account,
  })

  // Attributi indicizzati: arkiv/schema.md §2. Nessun segreto, nessun dato
  // personale: le entità Arkiv sono pubbliche per costruzione.
  const attributes = {
    app: str("ancorhash"),
    type: str("notarization"),
    schema_version: i32(SCHEMA_VERSION),
    document_hash: bytes32(documentHash),
    swarm_address: bytes32(swarmAddress),
    org: str(slug(input.org, "unknown")),
    doc_type: str(slug(input.doc_type, "document")),
    chain_id: u64(chainId),
    notarized_at: u64(Date.now()),
  }

  // Payload: NON indicizzato ma PUBBLICAMENTE LEGGIBILE. Solo metadati di
  // presentazione. Mai la chiave, mai il nome del file, mai dati personali.
  const payload = {}
  if (typeof input.tx_hash === "string" && input.tx_hash !== "") payload.tx_hash = input.tx_hash
  if (typeof input.anchor_chain === "string") payload.anchor_chain = input.anchor_chain
  if (typeof input.explorer_url === "string") payload.explorer_url = input.explorer_url
  if (typeof input.description === "string") payload.description = input.description.slice(0, 2000)

  const result = await walletClient.createEntity({
    attributes,
    payload: jsonToPayload(payload),
    contentType: "application/json",
    expires: ExpirationTime.fromBlocks(lifetimeBlocks),
  })

  // expiresAt viene RILETTO dalla ricevuta: per una durata è un lower bound,
  // perché il motore la risolve contro il blocco in cui la tx atterra.
  process.stdout.write(
    JSON.stringify({
      ok: true,
      entity_key: result.entityKey,
      tx_hash: result.txHash,
      expires_at_block: result.expiresAt.toString(),
      lifetime_blocks: lifetimeBlocks,
      expiration_seconds: expirationSeconds,
      creator: account.address,
      chain_id: tiramisu.id,
    }) + "\n",
  )
}

main().catch((error) => {
  const code = error instanceof WriterError ? error.code : "arkiv_write_failed"
  let message = error?.message ?? "Errore sconosciuto."

  // Un wallet senza fondi non lo dice: restituisce un errore di esecuzione
  // opaco. guides/known-issues lo documenta — "an unfunded write can present
  // an opaque execution error. That error alone does not establish a funds
  // problem". Aggiungiamo l'indizio invece di farlo ridiagnosticare ogni volta.
  if (/execution error without revert data/i.test(message)) {
    message +=
      " — causa più probabile: il wallet firmatario non ha test GLM. " +
      "Faucet: https://hub.arkiv.network/faucet (richiede login e CAPTCHA). " +
      "Non è una prova di mancanza fondi: verificare anche saldo e ricevuta."
  }

  // Nessuno stack e nessun echo dell'input: l'output finisce nei log del backend.
  process.stdout.write(JSON.stringify({ ok: false, code, error: message }) + "\n")
  process.exit(1)
})
