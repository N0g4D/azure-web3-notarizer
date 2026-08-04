import { useCallback, useState } from 'react'
import { FileDropzone } from './components/FileDropzone'
import { Spinner } from './components/Spinner'
import { ApiError, notarize } from './lib/api'
import type { NotarizeResponse } from './lib/api'
import { sha256Hex } from './lib/hash'

/** Rete di destinazione del PoC: Ethereum Sepolia. */
const SEPOLIA_CHAIN_ID = 11155111
const ETHERSCAN_TX_URL = 'https://sepolia.etherscan.io/tx/'
/** Wallet mock del PoC (checksummato EIP-55, richiesto dal backend). */
const MOCK_WALLET_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

type Phase =
  | { kind: 'idle' }
  | { kind: 'hashing'; fileName: string }
  | { kind: 'ready'; fileName: string; hash: string }
  | { kind: 'submitting'; fileName: string; hash: string }
  | { kind: 'success'; fileName: string; hash: string; result: NotarizeResponse }
  | { kind: 'error'; fileName: string; hash: string; message: string }

function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const handleFileSelected = useCallback(async (file: File) => {
    setPhase({ kind: 'hashing', fileName: file.name })
    try {
      // Zero Data Leakage: SHA-256 calcolato nel browser, il file resta qui.
      const hash = await sha256Hex(file)
      setPhase({ kind: 'ready', fileName: file.name, hash })
    } catch {
      setPhase({
        kind: 'error',
        fileName: file.name,
        hash: '',
        message: 'Impossibile leggere il file selezionato.',
      })
    }
  }, [])

  const handleNotarize = useCallback(async () => {
    if (phase.kind !== 'ready' && phase.kind !== 'error') return
    const { fileName, hash } = phase
    if (!hash) return

    setPhase({ kind: 'submitting', fileName, hash })
    try {
      const result = await notarize({
        document_id: fileName,
        document_hash: hash,
        wallet_address: MOCK_WALLET_ADDRESS,
        chain_id: SEPOLIA_CHAIN_ID,
      })
      setPhase({ kind: 'success', fileName, hash, result })
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Backend non raggiungibile. Verifica che le Azure Functions siano in esecuzione su localhost:7071.'
      setPhase({ kind: 'error', fileName, hash, message })
    }
  }, [phase])

  const reset = useCallback(() => setPhase({ kind: 'idle' }), [])

  const isBusy = phase.kind === 'hashing' || phase.kind === 'submitting'

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 antialiased">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">
            A
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Ancorhash</h1>
            <p className="text-xs text-slate-500">
              Notarizzazione documentale su blockchain — Zero Data Leakage
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold">Notarizza un documento</h2>
          <p className="mt-1 text-sm text-slate-500">
            L'impronta SHA-256 del file è calcolata localmente con la Web
            Crypto API e ancorata su Ethereum Sepolia. Il documento non lascia
            mai il tuo dispositivo.
          </p>

          <div className="mt-6">
            {phase.kind === 'idle' && (
              <FileDropzone onFileSelected={handleFileSelected} />
            )}

            {phase.kind === 'hashing' && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-6 text-slate-600">
                <Spinner />
                <span>
                  Calcolo dell'hash SHA-256 di{' '}
                  <strong className="text-slate-800">{phase.fileName}</strong> nel
                  browser…
                </span>
              </div>
            )}

            {(phase.kind === 'ready' ||
              phase.kind === 'submitting' ||
              phase.kind === 'success' ||
              (phase.kind === 'error' && phase.hash !== '')) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="font-medium text-slate-500">Documento</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {phase.fileName}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Hash SHA-256 (calcolato localmente)
                    </dt>
                    <dd className="mt-0.5 break-all rounded-md bg-white px-3 py-2 font-mono text-xs text-indigo-700 ring-1 ring-slate-200">
                      {phase.hash}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>

          {(phase.kind === 'ready' ||
            phase.kind === 'submitting' ||
            (phase.kind === 'error' && phase.hash !== '')) && (
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={handleNotarize}
                disabled={isBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase.kind === 'submitting' ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Attesa conferma dalla rete Sepolia…
                  </>
                ) : (
                  'Notarizza su Blockchain'
                )}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={isBusy}
                className="rounded-lg px-4 py-2.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60"
              >
                Annulla
              </button>
            </div>
          )}

          {phase.kind === 'error' && (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              <strong className="font-semibold">Errore:</strong> {phase.message}
              {phase.hash === '' && (
                <button
                  type="button"
                  onClick={reset}
                  className="ml-3 font-medium underline"
                >
                  Riprova
                </button>
              )}
            </div>
          )}

          {phase.kind === 'success' && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-start gap-3">
                <svg
                  className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
                <div className="min-w-0">
                  <h3 className="font-semibold text-emerald-800">
                    Documento notarizzato con successo
                  </h3>
                  <p className="mt-1 text-sm text-emerald-700">
                    La transazione è stata trasmessa alla rete Ethereum Sepolia.
                  </p>
                  <p className="mt-3 break-all font-mono text-xs text-emerald-800">
                    {phase.result.tx_hash}
                  </p>
                  <a
                    href={`${ETHERSCAN_TX_URL}${phase.result.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                  >
                    Verifica su Etherscan
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                      />
                    </svg>
                  </a>
                </div>
              </div>
              <button
                type="button"
                onClick={reset}
                className="mt-4 text-sm font-medium text-emerald-700 underline"
              >
                Notarizza un altro documento
              </button>
            </div>
          )}
        </section>

        <footer className="mt-6 text-center text-xs text-slate-400">
          PoC Ancorhash — chain_id {SEPOLIA_CHAIN_ID} (Sepolia) · relayer
          gas-sponsored
        </footer>
      </main>
    </div>
  )
}

export default App
