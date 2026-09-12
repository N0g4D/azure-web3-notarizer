import { useCallback, useEffect, useRef, useState } from 'react'
import { Turnstile } from '@marsidev/react-turnstile'
import type { TurnstileInstance } from '@marsidev/react-turnstile'
import type { SwarmIdClient } from '@snaha/swarm-id'
import { ArkivRecordPanel } from './components/ArkivRecordPanel'
import { FileDropzone } from './components/FileDropzone'
import { Spinner } from './components/Spinner'
import { ApiError, getChains, notarize } from './lib/api'
import type { Chain, NotarizeResponse } from './lib/api'
import { sha256Hex } from './lib/hash'
import {
  SwarmError,
  UNKNOWN_STAMP,
  createSwarmClient,
  describeStamp,
  fetchStampStatus,
  toPublicAddress,
  uploadEncrypted,
  uploadUnavailableReason,
} from './lib/swarm'
import type { ConnectionInfo, StampStatus } from './lib/swarm'

/** Sitekey pubblica Cloudflare Turnstile (dal bundle Vite). */
const TURNSTILE_SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY as
  | string
  | undefined

/**
 * Block explorer per chain id: il backend espone solo chain_id e nome,
 * il link di verifica è una responsabilità di presentazione del frontend.
 * Chain senza explorer noto → si mostra il solo tx_hash, senza link.
 */
const EXPLORER_TX_URLS: Record<number, string> = {
  43113: 'https://testnet.snowtrace.io/tx/',
  11155111: 'https://sepolia.etherscan.io/tx/',
  80002: 'https://amoy.polygonscan.com/tx/',
  1: 'https://etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
}

/** Wallet mock del PoC (checksummato EIP-55, richiesto dal backend). */
const MOCK_WALLET_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

/** Ricarico fisso di servizio applicato sopra il costo di rete (USD). */
const SERVICE_FEE_USD = 1.48
/** Durata della simulazione di pagamento (checkout mock per le demo B2B). */
const PAYMENT_SIMULATION_MS = 2000

const SECONDS_PER_DAY = 86_400
/** Validità di default del record, in giorni. */
const DEFAULT_VALIDITY_DAYS = '30'
/** Tetto alla validità: oltre i 10 anni il costo dello stamp non ha senso. */
const MAX_VALIDITY_DAYS = 3650
/**
 * Preset demo: una vita di 60 secondi rende la scadenza osservabile durante
 * il judging. Con la sola unità "giorni" nessun giudice vedrebbe mai un
 * record scadere da solo.
 */
const DEMO_EXPIRATION_SECONDS = 60

/** Importo in USD a due decimali; sotto il centesimo mostra "<$0.01". */
function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return '<$0.01'
  return `$${amount.toFixed(2)}`
}

/** Suffisso di costo per il selettore: "(Gratis)" o "(~$0.02)". */
function formatChainCost(chain: Chain): string {
  if (chain.is_free) return '(Gratis)'
  if (chain.estimated_cost_usd <= 0) return '(costo n/d)'
  const rounded = chain.estimated_cost_usd.toFixed(2)
  // Sotto il centesimo mostriamo "<$0.01" invece di "~$0.00".
  return rounded === '0.00' ? '(<$0.01)' : `(~$${rounded})`
}

/** Reti disponibili, caricate dal backend al mount. */
type ChainsState =
  | { kind: 'loading' }
  | { kind: 'ready'; chains: Chain[] }
  | { kind: 'error'; message: string }

/**
 * Stato del documento. `swarmReference` è la reference cifrata completa
 * (128 hex, chiave inclusa) e resta confinata al browser: verso il backend
 * viaggia solo il suo indirizzo pubblico.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'analyzing'; fileName: string; progress: number }
  | { kind: 'preview'; fileName: string; hash: string; swarmReference: string }
  | {
      kind: 'submitting'
      fileName: string
      hash: string
      swarmReference: string
    }
  | {
      kind: 'success'
      fileName: string
      hash: string
      swarmReference: string
      result: NotarizeResponse
    }
  | {
      kind: 'error'
      fileName: string
      hash: string
      swarmReference: string
      message: string
    }

/** Icona ad ancora, stile feather: linee 2px, nessuna libreria esterna. */
function AnchorIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  )
}

function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [chainsState, setChainsState] = useState<ChainsState>({
    kind: 'loading',
  })
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null)

  // --- Swarm ID -----------------------------------------------------------
  const [swarmClient, setSwarmClient] = useState<SwarmIdClient | null>(null)
  const [swarmInfo, setSwarmInfo] = useState<ConnectionInfo | null>(null)
  const [swarmInitError, setSwarmInitError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  // canUpload non basta: lo stamp va guardato davvero (swarm/friction.md S-02).
  const [stamp, setStamp] = useState<StampStatus>(UNKNOWN_STAMP)

  // Il client monta un iframe nascosto e non è riutilizzabile dopo destroy():
  // va quindi creato dentro l'effect, così lo StrictMode ne ricrea uno nuovo.
  useEffect(() => {
    let isActive = true
    const client = createSwarmClient((info) => {
      if (isActive) setSwarmInfo(info)
    })

    client
      .initialize()
      .then(() => {
        if (isActive) setSwarmClient(client)
      })
      .catch((error: unknown) => {
        if (!isActive) return
        setSwarmInitError(
          error instanceof Error
            ? `Swarm ID non raggiungibile: ${error.message}`
            : 'Swarm ID non raggiungibile.',
        )
      })

    return () => {
      isActive = false
      client.destroy()
    }
  }, [])

  const handleSwarmConnect = useCallback(async () => {
    if (!swarmClient || isConnecting) return
    setIsConnecting(true)
    try {
      await swarmClient.connect()
    } catch (error) {
      setSwarmInitError(
        error instanceof Error
          ? `Connessione a Swarm ID annullata: ${error.message}`
          : 'Connessione a Swarm ID annullata.',
      )
    } finally {
      setIsConnecting(false)
    }
  }, [isConnecting, swarmClient])

  // Ogni volta che la connessione cambia, si rilegge il batch: un gift code
  // riscattato a metà sessione deve sbloccare la UI senza ricaricare.
  // Si dipende dall'id dell'identità e non dall'oggetto: ConnectionInfo arriva
  // nuovo a ogni notifica, e usarlo come dipendenza rileggerebbe il batch di
  // continuo.
  const swarmIdentityId = swarmInfo?.identity?.id
  const swarmCanUpload = swarmInfo?.canUpload
  useEffect(() => {
    if (!swarmClient || !swarmIdentityId) {
      setStamp(UNKNOWN_STAMP)
      return
    }
    let isActive = true
    setStamp(UNKNOWN_STAMP)
    void fetchStampStatus(swarmClient).then((next) => {
      if (isActive) setStamp(next)
    })
    return () => {
      isActive = false
    }
  }, [swarmClient, swarmIdentityId, swarmCanUpload])

  // "Pronto" solo con un batch che esiste ED è usable.
  const swarmBlocker = swarmInfo
    ? uploadUnavailableReason(swarmInfo, stamp)
    : 'Inizializzazione di Swarm ID…'
  const canUploadToSwarm = swarmBlocker === null

  // --- Validità del record ------------------------------------------------
  const [validityDays, setValidityDays] = useState(DEFAULT_VALIDITY_DAYS)
  const [isDemoExpiry, setIsDemoExpiry] = useState(false)

  const parsedDays = Number.parseInt(validityDays, 10)
  const isValidityValid =
    Number.isInteger(parsedDays) &&
    parsedDays >= 1 &&
    parsedDays <= MAX_VALIDITY_DAYS
  const expirationSeconds = isDemoExpiry
    ? DEMO_EXPIRATION_SECONDS
    : parsedDays * SECONDS_PER_DAY

  const loadChains = useCallback(async () => {
    setChainsState({ kind: 'loading' })
    try {
      const chains = await getChains()
      if (chains.length === 0) {
        setChainsState({
          kind: 'error',
          message: 'Nessuna rete configurata sul backend.',
        })
        return
      }
      setChainsState({ kind: 'ready', chains })
      // Preseleziona la prima rete, preservando un'eventuale scelta precedente.
      setSelectedChainId(
        (current) =>
          chains.find((c) => c.chain_id === current)?.chain_id ??
          chains[0].chain_id,
      )
    } catch (error) {
      setChainsState({
        kind: 'error',
        message:
          error instanceof ApiError
            ? error.message
            : 'Impossibile caricare le reti dal backend.',
      })
    }
  }, [])

  useEffect(() => {
    void loadChains()
  }, [loadChains])

  // Token anti-bot Turnstile: monouso, richiesto per ogni notarizzazione.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileInstance | null>(null)

  // Checkout simulato: nessun pagamento reale, solo la fase di attesa percepita.
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const paymentTimerRef = useRef<number | null>(null)

  const selectedChain =
    chainsState.kind === 'ready'
      ? chainsState.chains.find((c) => c.chain_id === selectedChainId)
      : undefined

  // Riepilogo finanziario: gas a carico del relayer + ricarico di servizio.
  const gasCostUsd =
    selectedChain && !selectedChain.is_free ? selectedChain.estimated_cost_usd : 0
  const totalUsd = gasCostUsd + SERVICE_FEE_USD

  // Ultimo file scelto: consente di riprovare l'upload dopo un errore Swarm
  // (tipicamente un gift code riscattato dopo il primo tentativo).
  const pendingFileRef = useRef<File | null>(null)

  const processFile = useCallback(
    async (file: File) => {
      pendingFileRef.current = file

      if (!swarmClient) {
        setPhase({
          kind: 'error',
          fileName: file.name,
          hash: '',
          swarmReference: '',
          message: swarmInitError ?? 'Swarm ID non è ancora pronto.',
        })
        return
      }

      setPhase({ kind: 'analyzing', fileName: file.name, progress: 0 })

      // L'hash è istantaneo e non dipende dalla rete: calcolarlo per primo
      // separa nettamente "file illeggibile" da "Swarm non disponibile".
      let hash: string
      try {
        hash = await sha256Hex(file)
      } catch {
        setPhase({
          kind: 'error',
          fileName: file.name,
          hash: '',
          swarmReference: '',
          message: 'Impossibile leggere il file selezionato.',
        })
        return
      }

      try {
        const swarmReference = await uploadEncrypted(
          swarmClient,
          file,
          stamp,
          (progress) =>
            setPhase((current) =>
              current.kind === 'analyzing' ? { ...current, progress } : current,
            ),
        )
        setPhase({
          kind: 'preview',
          fileName: file.name,
          hash,
          swarmReference,
        })
      } catch (error) {
        setPhase({
          kind: 'error',
          fileName: file.name,
          hash,
          swarmReference: '',
          message:
            error instanceof SwarmError
              ? error.message
              : 'Upload su Swarm fallito.',
        })
      }
    },
    [stamp, swarmClient, swarmInitError],
  )

  const retryUpload = useCallback(() => {
    const file = pendingFileRef.current
    if (file) void processFile(file)
  }, [processFile])

  const handleNotarize = useCallback(async () => {
    if (phase.kind !== 'preview' && phase.kind !== 'error') return
    const { fileName, hash, swarmReference } = phase
    // Invariante del vault: nessuna ancora on-chain senza il blob cifrato.
    if (!hash || !swarmReference || selectedChainId === null) return
    if (!isDemoExpiry && !isValidityValid) return
    // Con Turnstile configurato il token è obbligatorio; senza sitekey
    // (solo dev) si prosegue e sarà il backend a respingere con 403.
    if (TURNSTILE_SITEKEY !== undefined && turnstileToken === null) return

    setPhase({ kind: 'submitting', fileName, hash, swarmReference })
    try {
      const result = await notarize({
        document_id: fileName,
        document_hash: hash,
        // Solo l'indirizzo: la chiave di decifratura non lascia il browser.
        swarm_address: toPublicAddress(swarmReference),
        expiration_seconds: expirationSeconds,
        wallet_address: MOCK_WALLET_ADDRESS,
        chain_id: selectedChainId,
        turnstile_token: turnstileToken ?? '',
      })
      setPhase({ kind: 'success', fileName, hash, swarmReference, result })
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Backend non raggiungibile. Verifica che le Azure Functions siano in esecuzione su localhost:7071.'
      setPhase({ kind: 'error', fileName, hash, swarmReference, message })
    } finally {
      // Il token è monouso: forziamo un nuovo challenge per il prossimo tentativo.
      setTurnstileToken(null)
      turnstileRef.current?.reset()
    }
  }, [
    expirationSeconds,
    isDemoExpiry,
    isValidityValid,
    phase,
    selectedChainId,
    turnstileToken,
  ])

  /**
   * Checkout mock: mostra una fase di "pagamento in corso" per qualche secondo,
   * poi delega alla notarizzazione reale. Nessun addebito viene effettuato.
   */
  const handleCheckout = useCallback(() => {
    if (isProcessingPayment) return
    setIsProcessingPayment(true)
    paymentTimerRef.current = window.setTimeout(() => {
      paymentTimerRef.current = null
      setIsProcessingPayment(false)
      void handleNotarize()
    }, PAYMENT_SIMULATION_MS)
  }, [handleNotarize, isProcessingPayment])

  const cancelPendingPayment = useCallback(() => {
    if (paymentTimerRef.current !== null) {
      window.clearTimeout(paymentTimerRef.current)
      paymentTimerRef.current = null
    }
    setIsProcessingPayment(false)
  }, [])

  // Evita che un timer pendente scriva stato su un componente smontato.
  useEffect(() => cancelPendingPayment, [cancelPendingPayment])

  const reset = useCallback(() => {
    cancelPendingPayment()
    pendingFileRef.current = null
    setPhase({ kind: 'idle' })
    setTurnstileToken(null)
  }, [cancelPendingPayment])

  const isBusy = phase.kind === 'analyzing' || phase.kind === 'submitting'
  const showPreview =
    phase.kind === 'preview' ||
    phase.kind === 'submitting' ||
    phase.kind === 'success' ||
    (phase.kind === 'error' && phase.hash !== '')
  // Il checkout compare solo quando il documento è davvero su Swarm.
  const showCheckout =
    (phase.kind === 'preview' ||
      phase.kind === 'submitting' ||
      phase.kind === 'error') &&
    phase.swarmReference !== ''

  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 antialiased">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-5">
          <AnchorIcon className="h-5 w-5 text-neutral-900" />
          <h1 className="text-lg font-bold tracking-tight">Ancorhash</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="text-2xl font-bold tracking-tight">
          Notarizza un documento
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          Il documento è cifrato nel browser e archiviato su Swarm; la sua
          impronta SHA-256, calcolata localmente, viene ancorata on-chain. Il
          file in chiaro non lascia mai questo dispositivo.
        </p>

        <div className="mt-8">
          {phase.kind === 'idle' && (
            <>
              {/* Archiviazione cifrata: prerequisito della notarizzazione */}
              <div className="mb-5 rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Archiviazione cifrata (Swarm)
                  </h3>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                      canUploadToSwarm
                        ? 'border-neutral-900 text-neutral-900'
                        : 'border-neutral-200 text-neutral-500'
                    }`}
                  >
                    {canUploadToSwarm ? 'Pronto' : 'Non disponibile'}
                  </span>
                </div>

                {swarmInfo?.identity ? (
                  <dl className="mt-3 space-y-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-neutral-500">Identità</dt>
                      <dd className="font-medium text-neutral-900">
                        {swarmInfo.identity.name}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-neutral-500">Indirizzo</dt>
                      <dd className="break-all font-mono text-neutral-700">
                        {swarmInfo.identity.address}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-neutral-500">
                        Postage stamp
                      </dt>
                      <dd className="text-neutral-700">
                        {!stamp.checked ? (
                          <span className="text-neutral-400">verifica in corso…</span>
                        ) : stamp.error ? (
                          <span className="text-neutral-500">{stamp.error}</span>
                        ) : stamp.batch ? (
                          <>
                            <span className="break-all font-mono">
                              {stamp.batch.batchID.slice(0, 16)}…
                            </span>
                            <span className="ml-2">
                              {stamp.batch.usable ? 'utilizzabile' : 'NON utilizzabile'}
                            </span>
                            <span className="block text-neutral-400">
                              {describeStamp(stamp.batch)}
                            </span>
                          </>
                        ) : (
                          <span className="text-neutral-500">nessuno</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3 text-xs text-neutral-500">
                    Accedi a Swarm ID con la tua seed phrase. Nessun nodo Bee da
                    installare.
                  </p>
                )}

                {swarmBlocker !== null && (
                  <p className="mt-2 text-xs text-neutral-400">
                    {swarmInitError ?? swarmBlocker}
                  </p>
                )}

                {!swarmInfo?.identity && (
                  <button
                    type="button"
                    onClick={() => void handleSwarmConnect()}
                    disabled={swarmClient === null || isConnecting}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isConnecting ? (
                      <>
                        <Spinner className="h-3.5 w-3.5" />
                        Connessione…
                      </>
                    ) : (
                      'Connetti Swarm ID'
                    )}
                  </button>
                )}
              </div>

              <div className="mb-5">
                <label
                  htmlFor="chain-select"
                  className="text-xs font-medium text-neutral-500"
                >
                  Rete di destinazione
                </label>

                {chainsState.kind === 'loading' && (
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-400">
                    <Spinner className="h-3.5 w-3.5" />
                    Caricamento reti disponibili…
                  </div>
                )}

                {chainsState.kind === 'error' && (
                  <div className="mt-1.5 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                    {chainsState.message}{' '}
                    <button
                      type="button"
                      onClick={() => void loadChains()}
                      className="font-medium text-neutral-900 underline underline-offset-2"
                    >
                      Riprova
                    </button>
                  </div>
                )}

                {chainsState.kind === 'ready' && (
                  <div className="relative mt-1.5">
                    <select
                      id="chain-select"
                      value={selectedChainId ?? ''}
                      onChange={(e) =>
                        setSelectedChainId(Number(e.target.value))
                      }
                      className="w-full cursor-pointer appearance-none rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-9 text-sm text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none"
                    >
                      {chainsState.chains.map((chain) => (
                        <option key={chain.chain_id} value={chain.chain_id}>
                          {chain.name} {formatChainCost(chain)}
                        </option>
                      ))}
                    </select>
                    <svg
                      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                )}
              </div>

              <FileDropzone
                onFileSelected={(file) => void processFile(file)}
                disabled={!canUploadToSwarm}
              />
              {!canUploadToSwarm && (
                <p className="mt-3 text-xs text-neutral-400">
                  Connetti Swarm ID per caricare un documento: senza
                  archiviazione cifrata non c'è nulla da notarizzare.
                </p>
              )}
            </>
          )}

          {phase.kind === 'analyzing' && (
            <div className="flex items-center gap-3 rounded-lg border border-neutral-200 px-5 py-6 text-sm text-neutral-600">
              <Spinner className="h-4 w-4" />
              <span>
                Cifratura e upload di{' '}
                <span className="font-medium text-neutral-900">
                  {phase.fileName}
                </span>{' '}
                su Swarm
                {phase.progress > 0 ? ` — ${phase.progress}%` : '…'}
              </span>
            </div>
          )}

          {showPreview && (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-neutral-900">
                  {phase.fileName}
                </p>
                {phase.kind !== 'success' && (
                  <button
                    type="button"
                    onClick={reset}
                    disabled={isBusy}
                    className="text-xs text-neutral-400 underline-offset-2 hover:text-neutral-900 hover:underline disabled:opacity-50"
                  >
                    cambia file
                  </button>
                )}
              </div>

              {/* Blocco 1: impronta crittografica */}
              <section className="rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Impronta Crittografica (SHA-256)
                  </h3>
                  <span className="shrink-0 rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                    Calcolata localmente
                  </span>
                </div>
                <p className="mt-3 break-all font-mono text-xs leading-relaxed text-neutral-700">
                  {phase.hash}
                </p>
              </section>

              {/* Blocco 2: blob cifrato su Swarm */}
              <section className="rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Documento Cifrato (Swarm)
                  </h3>
                  {phase.swarmReference !== '' && (
                    <span className="shrink-0 rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                      Cifrato nel browser
                    </span>
                  )}
                </div>

                {phase.swarmReference !== '' ? (
                  <>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div>
                        <dt className="font-medium text-neutral-500">
                          Indirizzo pubblico (inviato al backend)
                        </dt>
                        <dd className="mt-0.5 break-all font-mono text-neutral-700">
                          {toPublicAddress(phase.swarmReference)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-neutral-500">
                          Reference completa — include la chiave di decifratura
                        </dt>
                        <dd className="mt-0.5 break-all font-mono text-neutral-700">
                          {phase.swarmReference}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
                      Conserva la reference completa: è l'unico modo per
                      rileggere il documento. Non viene inviata a nessun
                      server.
                    </p>
                  </>
                ) : (
                  <div className="mt-3">
                    <p className="text-xs text-neutral-400">
                      Il documento non è su Swarm: la notarizzazione resta
                      bloccata finché l'upload non riesce.
                    </p>
                    <button
                      type="button"
                      onClick={retryUpload}
                      disabled={isBusy || !canUploadToSwarm}
                      className="mt-3 inline-flex items-center rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Riprova upload
                    </button>
                  </div>
                )}
              </section>

              {/* Blocco 3: validità del record */}
              {phase.kind !== 'success' && phase.swarmReference !== '' && (
                <section className="rounded-lg border border-neutral-200 p-5">
                  <h3 className="text-sm font-semibold">Validità del record</h3>

                  <div className="mt-3 flex items-center gap-2">
                    <label
                      htmlFor="validity-days"
                      className="text-sm text-neutral-600"
                    >
                      Giorni di validità
                    </label>
                    <input
                      id="validity-days"
                      type="number"
                      min={1}
                      max={MAX_VALIDITY_DAYS}
                      value={validityDays}
                      disabled={isDemoExpiry || isBusy}
                      onChange={(e) => setValidityDays(e.target.value)}
                      className="w-24 rounded-lg border border-neutral-200 px-3 py-1.5 font-mono text-sm text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400"
                    />
                  </div>

                  {!isDemoExpiry && !isValidityValid && (
                    <p className="mt-2 text-xs text-neutral-500">
                      Inserisci un numero intero di giorni tra 1 e{' '}
                      {MAX_VALIDITY_DAYS}.
                    </p>
                  )}

                  <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-neutral-600">
                    <input
                      type="checkbox"
                      checked={isDemoExpiry}
                      disabled={isBusy}
                      onChange={(e) => setIsDemoExpiry(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-300 accent-black"
                    />
                    <span>
                      Demo ETHRome — scade tra {DEMO_EXPIRATION_SECONDS} secondi
                    </span>
                  </label>

                  <p className="mt-3 text-[11px] text-neutral-400">
                    Inviato al backend come{' '}
                    <span className="font-mono">
                      expiration_seconds = {expirationSeconds || 0}
                    </span>
                  </p>
                </section>
              )}
            </div>
          )}
        </div>

        {showCheckout && (
          <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Checkout</h3>
              <span className="text-[11px] text-neutral-400">
                Pagamento simulato — nessun addebito reale
              </span>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-neutral-500">Costo Rete (Gas)</dt>
                <dd className="font-mono text-neutral-900">
                  {formatUsd(gasCostUsd)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-neutral-500">Commissione di Servizio</dt>
                <dd className="font-mono text-neutral-900">
                  {formatUsd(SERVICE_FEE_USD)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-neutral-200 pt-2 font-semibold text-neutral-900">
                <dt>Totale da Pagare</dt>
                <dd className="font-mono">${totalUsd.toFixed(2)}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <label
                htmlFor="card-number"
                className="text-xs font-medium text-neutral-500"
              >
                Metodo di pagamento
              </label>
              <input
                id="card-number"
                type="text"
                disabled
                readOnly
                value="•••• •••• •••• 4242"
                className="mt-1.5 w-full cursor-not-allowed rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-500"
              />
              <p className="mt-1.5 text-[11px] text-neutral-400">
                Powered by Stripe
              </p>
            </div>

            {TURNSTILE_SITEKEY ? (
              <div className="mt-4">
                <Turnstile
                  ref={turnstileRef}
                  siteKey={TURNSTILE_SITEKEY}
                  options={{ theme: 'light', size: 'flexible' }}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onExpire={() => setTurnstileToken(null)}
                  onError={() => setTurnstileToken(null)}
                />
              </div>
            ) : (
              <p className="mt-4 text-xs text-neutral-400">
                Turnstile non configurato (VITE_TURNSTILE_SITEKEY mancante): la
                verifica anti-bot è disabilitata.
              </p>
            )}

            <button
              type="button"
              onClick={handleCheckout}
              disabled={
                isBusy ||
                isProcessingPayment ||
                selectedChainId === null ||
                (!isDemoExpiry && !isValidityValid) ||
                (TURNSTILE_SITEKEY !== undefined && turnstileToken === null)
              }
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isProcessingPayment ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Elaborazione pagamento…
                </>
              ) : phase.kind === 'submitting' ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Attesa conferma da {selectedChain?.name ?? 'rete'}…
                </>
              ) : (
                `Paga $${totalUsd.toFixed(2)} e Notarizza`
              )}
            </button>
          </div>
        )}

        {phase.kind === 'error' && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
          >
            <span className="font-semibold text-neutral-900">Errore:</span>{' '}
            {phase.message}
            {phase.hash === '' && (
              <button
                type="button"
                onClick={reset}
                className="ml-3 font-medium text-neutral-900 underline underline-offset-2"
              >
                Riprova
              </button>
            )}
          </div>
        )}

        {phase.kind === 'success' && (
          <div className="mt-6 rounded-lg border border-neutral-200 p-5">
            <div className="flex items-center gap-2">
              <svg
                className="h-4 w-4 text-neutral-900"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <h3 className="text-sm font-semibold">Transazione confermata</h3>
            </div>
            <p className="mt-2 break-all font-mono text-xs text-neutral-500">
              {phase.result.tx_hash}
            </p>
            <div className="mt-4 flex items-center gap-5 text-sm">
              {EXPLORER_TX_URLS[phase.result.chain_id] && (
                <a
                  href={`${EXPLORER_TX_URLS[phase.result.chain_id]}${phase.result.tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600"
                >
                  Verifica sull'explorer
                </a>
              )}
              <button
                type="button"
                onClick={reset}
                className="text-neutral-500 hover:text-neutral-900"
              >
                Notarizza un altro documento
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'success' && (
          <div className="mt-4">
            <ArkivRecordPanel documentHash={phase.hash} />
          </div>
        )}

        <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
          PoC Ancorhash ·{' '}
          {selectedChain
            ? `${selectedChain.name} (chain_id ${selectedChain.chain_id})`
            : 'nessuna rete selezionata'}{' '}
          · Swarm + relayer gas-sponsored
        </footer>
      </main>
    </div>
  )
}

export default App
