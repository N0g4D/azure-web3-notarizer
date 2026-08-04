import { useCallback, useEffect, useState } from 'react'
import { FileDropzone } from './components/FileDropzone'
import { Spinner } from './components/Spinner'
import { ApiError, extract, getChains, notarize } from './lib/api'
import type { Chain, ExtractResponse, NotarizeResponse } from './lib/api'
import { sha256Hex } from './lib/hash'

/**
 * Block explorer per chain id: il backend espone solo chain_id e nome,
 * il link di verifica è una responsabilità di presentazione del frontend.
 * Chain senza explorer noto → si mostra il solo tx_hash, senza link.
 */
const EXPLORER_TX_URLS: Record<number, string> = {
  11155111: 'https://sepolia.etherscan.io/tx/',
  80002: 'https://amoy.polygonscan.com/tx/',
  1: 'https://etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
}

/** Wallet mock del PoC (checksummato EIP-55, richiesto dal backend). */
const MOCK_WALLET_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

/** Reti disponibili, caricate dal backend al mount. */
type ChainsState =
  | { kind: 'loading' }
  | { kind: 'ready'; chains: Chain[] }
  | { kind: 'error'; message: string }

/**
 * Esito dell'estrazione AI: opzionale, il flusso prosegue anche se fallisce.
 * 'opt-out' = l'utente non ha acconsentito all'invio del file al cloud
 * (Zero Data Leakage): il documento non lascia mai il dispositivo.
 */
type Extraction =
  | { status: 'ok'; data: ExtractResponse }
  | { status: 'failed'; message: string }
  | { status: 'opt-out' }

type Phase =
  | { kind: 'idle' }
  | { kind: 'analyzing'; fileName: string }
  | { kind: 'preview'; fileName: string; hash: string; extraction: Extraction }
  | { kind: 'submitting'; fileName: string; hash: string; extraction: Extraction }
  | {
      kind: 'success'
      fileName: string
      hash: string
      extraction: Extraction
      result: NotarizeResponse
    }
  | {
      kind: 'error'
      fileName: string
      hash: string
      extraction: Extraction | null
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
  // Opt-in esplicito: senza consenso il file non viene MAI inviato al cloud.
  const [isAiEnabled, setIsAiEnabled] = useState(false)
  const [chainsState, setChainsState] = useState<ChainsState>({
    kind: 'loading',
  })
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null)

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

  const selectedChain =
    chainsState.kind === 'ready'
      ? chainsState.chains.find((c) => c.chain_id === selectedChainId)
      : undefined

  const handleFileSelected = useCallback(
    async (file: File) => {
      setPhase({ kind: 'analyzing', fileName: file.name })

      // Hash locale e OCR remoto partono insieme e non si bloccano a vicenda.
      // Senza consenso, l'estrazione si risolve subito in 'opt-out' e nessun
      // byte del documento lascia il dispositivo (Zero Data Leakage).
      // Con consenso, è "best effort": un suo fallimento non ferma il flusso.
      const extractionPromise: Promise<Extraction> = isAiEnabled
        ? extract(file)
            .then((data): Extraction => ({ status: 'ok', data }))
            .catch(
              (error): Extraction => ({
                status: 'failed',
                message:
                  error instanceof ApiError
                    ? error.message
                    : 'Servizio AI non raggiungibile.',
              }),
            )
        : Promise.resolve({ status: 'opt-out' })

      try {
        const [hash, extraction] = await Promise.all([
          sha256Hex(file),
          extractionPromise,
        ])
        setPhase({ kind: 'preview', fileName: file.name, hash, extraction })
      } catch {
        // L'hash è l'unico requisito irrinunciabile per notarizzare.
        setPhase({
          kind: 'error',
          fileName: file.name,
          hash: '',
          extraction: null,
          message: 'Impossibile leggere il file selezionato.',
        })
      }
    },
    [isAiEnabled],
  )

  const handleNotarize = useCallback(async () => {
    if (phase.kind !== 'preview' && phase.kind !== 'error') return
    const { fileName, hash, extraction } = phase
    if (!hash || extraction === null || selectedChainId === null) return

    setPhase({ kind: 'submitting', fileName, hash, extraction })
    try {
      const result = await notarize({
        document_id: fileName,
        document_hash: hash,
        wallet_address: MOCK_WALLET_ADDRESS,
        chain_id: selectedChainId,
      })
      setPhase({ kind: 'success', fileName, hash, extraction, result })
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Backend non raggiungibile. Verifica che le Azure Functions siano in esecuzione su localhost:7071.'
      setPhase({ kind: 'error', fileName, hash, extraction, message })
    }
  }, [phase, selectedChainId])

  const reset = useCallback(() => setPhase({ kind: 'idle' }), [])

  const isBusy = phase.kind === 'analyzing' || phase.kind === 'submitting'
  const showPreview =
    phase.kind === 'preview' ||
    phase.kind === 'submitting' ||
    phase.kind === 'success' ||
    (phase.kind === 'error' && phase.hash !== '')

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
          L'impronta SHA-256 è calcolata localmente nel browser e ancorata su
          Ethereum Sepolia. L'analisi AI estrae i dati del documento. Il file
          non viene mai caricato per la notarizzazione.
        </p>

        <div className="mt-8">
          {phase.kind === 'idle' && (
            <>
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
                          {chain.name}
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

              <FileDropzone onFileSelected={handleFileSelected} />
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-neutral-600">
                <input
                  type="checkbox"
                  checked={isAiEnabled}
                  onChange={(e) => setIsAiEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-300 accent-black"
                />
                <span>
                  Consenti l'invio del documento al cloud per l'estrazione dei
                  dati (Azure AI)
                </span>
              </label>
            </>
          )}

          {phase.kind === 'analyzing' && (
            <div className="flex items-center gap-3 rounded-lg border border-neutral-200 px-5 py-6 text-sm text-neutral-600">
              <Spinner className="h-4 w-4" />
              <span>
                Analisi di{' '}
                <span className="font-medium text-neutral-900">
                  {phase.fileName}
                </span>
                {isAiEnabled
                  ? ': hash locale e estrazione AI in parallelo…'
                  : ': calcolo dell’hash nel browser…'}
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

              {/* Blocco 2: dati estratti dall'AI (best effort) */}
              <section className="rounded-lg border border-neutral-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Dati Estratti (Azure AI)
                  </h3>
                  {phase.extraction?.status === 'ok' && (
                    <span className="shrink-0 rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
                      {phase.extraction.data.page_count}{' '}
                      {phase.extraction.data.page_count === 1
                        ? 'pagina'
                        : 'pagine'}
                    </span>
                  )}
                </div>

                {phase.extraction?.status === 'ok' ? (
                  <div className="mt-3 space-y-3">
                    {Object.keys(phase.extraction.data.key_value_pairs).length >
                      0 && (
                      <dl className="space-y-1 text-xs">
                        {Object.entries(
                          phase.extraction.data.key_value_pairs,
                        ).map(([key, value]) => (
                          <div key={key} className="flex gap-2">
                            <dt className="shrink-0 font-medium text-neutral-500">
                              {key}
                            </dt>
                            <dd className="text-neutral-900">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-700">
                      {phase.extraction.data.content || '(nessun testo estratto)'}
                    </pre>
                  </div>
                ) : phase.extraction?.status === 'opt-out' ? (
                  <p className="mt-3 text-xs text-neutral-400">
                    Analisi AI disabilitata per tutelare la privacy (Zero Data
                    Leakage). Il documento non ha mai lasciato questo
                    dispositivo.
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-neutral-400">
                    {phase.extraction?.status === 'failed'
                      ? `Estrazione non disponibile: ${phase.extraction.message} Puoi comunque procedere con la notarizzazione dell'hash.`
                      : 'Estrazione non eseguita.'}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>

        {(phase.kind === 'preview' ||
          phase.kind === 'submitting' ||
          (phase.kind === 'error' && phase.hash !== '')) && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleNotarize}
              disabled={isBusy || selectedChainId === null}
              className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase.kind === 'submitting' ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Attesa conferma da {selectedChain?.name ?? 'rete'}…
                </>
              ) : (
                `Notarizza su ${selectedChain?.name ?? 'Blockchain'}`
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

        <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
          PoC Ancorhash ·{' '}
          {selectedChain
            ? `${selectedChain.name} (chain_id ${selectedChain.chain_id})`
            : 'nessuna rete selezionata'}{' '}
          · relayer gas-sponsored
        </footer>
      </main>
    </div>
  )
}

export default App
