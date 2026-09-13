import { useCallback, useEffect, useRef, useState } from 'react'
import { Turnstile } from '@marsidev/react-turnstile'
import type { TurnstileInstance } from '@marsidev/react-turnstile'
import type { SwarmIdClient } from '@snaha/swarm-id'
import { ArkivRecordPanel } from './components/ArkivRecordPanel'
import { FileDropzone } from './components/FileDropzone'
import { VerifyPanel } from './components/VerifyPanel'
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

/** Public Cloudflare Turnstile sitekey (from the Vite bundle). */
const TURNSTILE_SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY as
  | string
  | undefined

/**
 * Block explorer per chain id: the backend exposes only chain_id and name, so
 * the verification link is a frontend presentation concern.
 * A chain with no known explorer → show the tx_hash alone, unlinked.
 */
const EXPLORER_TX_URLS: Record<number, string> = {
  43113: 'https://testnet.snowtrace.io/tx/',
  11155111: 'https://sepolia.etherscan.io/tx/',
  80002: 'https://amoy.polygonscan.com/tx/',
  1: 'https://etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
}

/** PoC mock wallet (EIP-55 checksummed, required by the backend). */
const MOCK_WALLET_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

/** Fixed service markup applied on top of the network cost (USD). */
const SERVICE_FEE_USD = 1.48
/** Payment simulation duration (mock checkout for B2B demos). */
const PAYMENT_SIMULATION_MS = 2000

const SECONDS_PER_DAY = 86_400
/** Default record validity, in days. */
const DEFAULT_VALIDITY_DAYS = '30'
/** Validity ceiling: beyond 10 years the stamp cost stops making sense. */
const MAX_VALIDITY_DAYS = 3650
/**
 * Demo preset. A lifetime long enough to narrate on camera: 110 s is about
 * 55 blocks at the nominal 2 s cadence, leaving room to show the record, the
 * countdown and then the disappearance without rushing. 60 s was too tight
 * once the Swarm upload and the Fuji mint had eaten into the window.
 *
 * Measured on 2026-09-12: created 16:55:05, still returned at block 358329,
 * gone at block 358332 (16:56:58) -- 113 s wall clock, no Delete call.
 */
const DEMO_EXPIRATION_SECONDS = 110

/** USD amount to two decimals; below a cent it shows "<$0.01". */
function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return '<$0.01'
  return `$${amount.toFixed(2)}`
}

/** Cost suffix for the selector: "(Free)" or "(~$0.02)". */
function formatChainCost(chain: Chain): string {
  if (chain.is_free) return '(Free)'
  if (chain.estimated_cost_usd <= 0) return '(cost n/a)'
  const rounded = chain.estimated_cost_usd.toFixed(2)
  // Below a cent show "<$0.01" rather than "~$0.00".
  return rounded === '0.00' ? '(<$0.01)' : `(~$${rounded})`
}

/** Available networks, loaded from the backend on mount. */
type ChainsState =
  | { kind: 'loading' }
  | { kind: 'ready'; chains: Chain[] }
  | { kind: 'error'; message: string }

/**
 * Document state. `swarmReference` is the full encrypted reference (128 hex,
 * key included) and stays confined to the browser: only its public address
 * travels to the backend.
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

/** Anchor icon, feather style: 2px strokes, no external library. */
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

/**
 * Read-only build. A static public deployment has no backend, so the notarize
 * flow cannot work there while verification can — verification is pure
 * browser-side Arkiv reads. The landing mode follows that.
 *
 * An explicit flag rather than inferring it from VITE_API_BASE_URL: that
 * variable has a hardcoded localhost fallback and is not set in development
 * either, so inferring from it would silently put local dev in read-only too.
 */
const IS_READ_ONLY = import.meta.env.VITE_READ_ONLY === 'true'
const HAS_BACKEND = !IS_READ_ONLY

type Mode = 'verify' | 'notarize'

function App() {
  const [mode, setMode] = useState<Mode>(HAS_BACKEND ? 'notarize' : 'verify')
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
  // canUpload is not enough: the stamp must actually be inspected (swarm/friction.md S-02).
  const [stamp, setStamp] = useState<StampStatus>(UNKNOWN_STAMP)

  // The client mounts a hidden iframe and cannot be reused after destroy(),
  // so it is created inside the effect and StrictMode builds a fresh one.
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
            ? `Swarm ID unreachable: ${error.message}`
            : 'Swarm ID unreachable.',
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
          ? `Swarm ID connection cancelled: ${error.message}`
          : 'Swarm ID connection cancelled.',
      )
    } finally {
      setIsConnecting(false)
    }
  }, [isConnecting, swarmClient])

  // The batch is re-read whenever the connection changes: a gift code
  // redeemed mid-session must unlock the UI without a reload.
  // Depend on the identity id rather than the object: ConnectionInfo arrives
  // fresh on every notification, and using it as a dependency would re-read
  // the batch continuously.
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

  // "Ready" only with a batch that exists AND is usable.
  const swarmBlocker = swarmInfo
    ? uploadUnavailableReason(swarmInfo, stamp)
    : 'Initialising Swarm ID…'
  const canUploadToSwarm = swarmBlocker === null

  // --- Record validity ----------------------------------------------------
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
          message: 'No network configured on the backend.',
        })
        return
      }
      setChainsState({ kind: 'ready', chains })
      // Preselect the first network, preserving any earlier choice.
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
            : 'Unable to load networks from the backend.',
      })
    }
  }, [])

  useEffect(() => {
    void loadChains()
  }, [loadChains])

  // Turnstile anti-bot token: single-use, required for every notarization.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileInstance | null>(null)

  // Simulated checkout: no real payment, only the perceived waiting phase.
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const paymentTimerRef = useRef<number | null>(null)

  const selectedChain =
    chainsState.kind === 'ready'
      ? chainsState.chains.find((c) => c.chain_id === selectedChainId)
      : undefined

  // Financial summary: gas paid by the relayer + service markup.
  const gasCostUsd =
    selectedChain && !selectedChain.is_free ? selectedChain.estimated_cost_usd : 0
  const totalUsd = gasCostUsd + SERVICE_FEE_USD

  // Last selected file: allows retrying the upload after a Swarm error
  // (typically a gift code redeemed after the first attempt).
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
          message: swarmInitError ?? 'Swarm ID is not ready yet.',
        })
        return
      }

      setPhase({ kind: 'analyzing', fileName: file.name, progress: 0 })

      // Hashing is instant and network-independent: doing it first cleanly
      // separates "unreadable file" from "Swarm unavailable".
      let hash: string
      try {
        hash = await sha256Hex(file)
      } catch {
        setPhase({
          kind: 'error',
          fileName: file.name,
          hash: '',
          swarmReference: '',
          message: 'Unable to read the selected file.',
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
              : 'Swarm upload failed.',
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
    // Vault invariant: no on-chain anchor without the encrypted blob.
    if (!hash || !swarmReference || selectedChainId === null) return
    if (!isDemoExpiry && !isValidityValid) return
    // With Turnstile configured the token is mandatory; without a sitekey
    // (dev only) we proceed and let the backend reject with 403.
    if (TURNSTILE_SITEKEY !== undefined && turnstileToken === null) return

    setPhase({ kind: 'submitting', fileName, hash, swarmReference })
    try {
      const result = await notarize({
        document_id: fileName,
        document_hash: hash,
        // Address only: the decryption key never leaves the browser.
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
          : 'Backend unreachable. Check that the Azure Functions host is running on localhost:7071.'
      setPhase({ kind: 'error', fileName, hash, swarmReference, message })
    } finally {
      // The token is single-use: force a fresh challenge for the next attempt.
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
   * Mock checkout: shows a "payment in progress" phase for a few seconds, then
   * delegates to the real notarization. No charge is ever made.
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

  // Prevents a pending timer from writing state to an unmounted component.
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
  // Checkout appears only once the document is genuinely on Swarm.
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
          <nav className="ml-auto flex gap-1 text-sm">
            {(['verify', 'notarize'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  mode === m
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {m === 'verify' ? 'Verify' : 'Notarize'}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        {mode === 'verify' ? (
          <VerifyPanel swarmClient={swarmClient} />
        ) : (
        <>
        {!HAS_BACKEND && (
          <div className="mb-6 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-700">
            <strong>Read-only deployment.</strong> Notarizing needs the
            Ancorhash backend (the gas-sponsored relayer and the Arkiv writer),
            which is not part of this static build. Everything under{' '}
            <strong>Verify</strong> is fully live: it queries the public Arkiv
            index straight from your browser.
          </div>
        )}
        <h2 className="text-2xl font-bold tracking-tight">
          Notarize a document
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          The document is encrypted in your browser and stored on Swarm; its
          SHA-256 fingerprint, computed locally, is anchored on-chain. The
          plaintext file never leaves this device.
        </p>

        <div className="mt-8">
          {phase.kind === 'idle' && (
            <>
              {/* Encrypted storage: a prerequisite for notarization */}
              <div className="mb-5 rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Encrypted storage (Swarm)
                  </h3>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                      canUploadToSwarm
                        ? 'border-neutral-900 text-neutral-900'
                        : 'border-neutral-200 text-neutral-500'
                    }`}
                  >
                    {canUploadToSwarm ? 'Ready' : 'Unavailable'}
                  </span>
                </div>

                {swarmInfo?.identity ? (
                  <dl className="mt-3 space-y-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-neutral-500">Identity</dt>
                      <dd className="font-medium text-neutral-900">
                        {swarmInfo.identity.name}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-neutral-500">Address</dt>
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
                          <span className="text-neutral-400">checking…</span>
                        ) : stamp.error ? (
                          <span className="text-neutral-500">{stamp.error}</span>
                        ) : stamp.batch ? (
                          <>
                            <span className="break-all font-mono">
                              {stamp.batch.batchID.slice(0, 16)}…
                            </span>
                            <span className="ml-2">
                              {stamp.batch.usable ? 'usable' : 'NOT usable'}
                            </span>
                            <span className="block text-neutral-400">
                              {describeStamp(stamp.batch)}
                            </span>
                          </>
                        ) : (
                          <span className="text-neutral-500">none</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3 text-xs text-neutral-500">
                    Sign in to Swarm ID with your seed phrase. No Bee node to
                    install.
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
                        Connecting…
                      </>
                    ) : (
                      'Connect Swarm ID'
                    )}
                  </button>
                )}
              </div>

              <div className="mb-5">
                <label
                  htmlFor="chain-select"
                  className="text-xs font-medium text-neutral-500"
                >
                  Target network
                </label>

                {chainsState.kind === 'loading' && (
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-400">
                    <Spinner className="h-3.5 w-3.5" />
                    Loading available networks…
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
                      Retry
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
                  Connect Swarm ID to upload a document: without encrypted
                  storage there is nothing to notarize.
                </p>
              )}
            </>
          )}

          {phase.kind === 'analyzing' && (
            <div className="flex items-center gap-3 rounded-lg border border-neutral-200 px-5 py-6 text-sm text-neutral-600">
              <Spinner className="h-4 w-4" />
              <span>
                Encrypting and uploading{' '}
                <span className="font-medium text-neutral-900">
                  {phase.fileName}
                </span>{' '}
                to Swarm
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
                    change file
                  </button>
                )}
              </div>

              {/* Block 1: cryptographic fingerprint */}
              <section className="rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Cryptographic fingerprint (SHA-256)
                  </h3>
                  <span className="shrink-0 rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                    Computed locally
                  </span>
                </div>
                <p className="mt-3 break-all font-mono text-xs leading-relaxed text-neutral-700">
                  {phase.hash}
                </p>
              </section>

              {/* Block 2: encrypted blob on Swarm */}
              <section className="rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Encrypted document (Swarm)
                  </h3>
                  {phase.swarmReference !== '' && (
                    <span className="shrink-0 rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                      Encrypted in the browser
                    </span>
                  )}
                </div>

                {phase.swarmReference !== '' ? (
                  <>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div>
                        <dt className="font-medium text-neutral-500">
                          Public address (sent to the backend)
                        </dt>
                        <dd className="mt-0.5 break-all font-mono text-neutral-700">
                          {toPublicAddress(phase.swarmReference)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-neutral-500">
                          Full reference — includes the decryption key
                        </dt>
                        <dd className="mt-0.5 break-all font-mono text-neutral-700">
                          {phase.swarmReference}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
                      Keep the full reference: it is the only way to read the
                      document back. It is never sent to any server.
                    </p>
                  </>
                ) : (
                  <div className="mt-3">
                    <p className="text-xs text-neutral-400">
                      The document is not on Swarm: notarization stays blocked
                      until the upload succeeds.
                    </p>
                    <button
                      type="button"
                      onClick={retryUpload}
                      disabled={isBusy || !canUploadToSwarm}
                      className="mt-3 inline-flex items-center rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Retry upload
                    </button>
                  </div>
                )}
              </section>

              {/* Block 3: record validity */}
              {phase.kind !== 'success' && phase.swarmReference !== '' && (
                <section className="rounded-lg border border-neutral-200 p-5">
                  <h3 className="text-sm font-semibold">Record validity</h3>

                  <div className="mt-3 flex items-center gap-2">
                    <label
                      htmlFor="validity-days"
                      className="text-sm text-neutral-600"
                    >
                      Days of validity
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
                      Enter a whole number of days between 1 and{' '}
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
                      ETHRome demo — expires in {DEMO_EXPIRATION_SECONDS} seconds
                    </span>
                  </label>

                  <p className="mt-3 text-[11px] text-neutral-400">
                    Sent to the backend as{' '}
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
                Simulated payment — no real charge
              </span>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-neutral-500">Network cost (gas)</dt>
                <dd className="font-mono text-neutral-900">
                  {formatUsd(gasCostUsd)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-neutral-500">Service fee</dt>
                <dd className="font-mono text-neutral-900">
                  {formatUsd(SERVICE_FEE_USD)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-neutral-200 pt-2 font-semibold text-neutral-900">
                <dt>Total due</dt>
                <dd className="font-mono">${totalUsd.toFixed(2)}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <label
                htmlFor="card-number"
                className="text-xs font-medium text-neutral-500"
              >
                Payment method
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
                Turnstile not configured (VITE_TURNSTILE_SITEKEY missing):
                anti-bot verification is disabled.
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
                  Processing payment…
                </>
              ) : phase.kind === 'submitting' ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Awaiting confirmation from {selectedChain?.name ?? 'network'}…
                </>
              ) : (
                `Pay $${totalUsd.toFixed(2)} and notarize`
              )}
            </button>
          </div>
        )}

        {phase.kind === 'error' && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
          >
            <span className="font-semibold text-neutral-900">Error:</span>{' '}
            {phase.message}
            {phase.hash === '' && (
              <button
                type="button"
                onClick={reset}
                className="ml-3 font-medium text-neutral-900 underline underline-offset-2"
              >
                Retry
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
              <h3 className="text-sm font-semibold">Transaction confirmed</h3>
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
                  Verify on the explorer
                </a>
              )}
              <button
                type="button"
                onClick={reset}
                className="text-neutral-500 hover:text-neutral-900"
              >
                Notarize another document
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'success' && (
          <div className="mt-4">
            <ArkivRecordPanel documentHash={phase.hash} result={phase.result} />
          </div>
        )}

        </>
        )}

        <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
          PoC Ancorhash ·{' '}
          {selectedChain
            ? `${selectedChain.name} (chain_id ${selectedChain.chain_id})`
            : 'no network selected'}{' '}
          · Swarm + gas-sponsored relayer
        </footer>
      </main>
    </div>
  )
}

export default App
