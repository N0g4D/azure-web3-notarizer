import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from './Spinner'
import { ARKIV_CREATOR_ADDRESS, findByDocumentHash, getHead } from '../lib/arkiv'
import type { NotarizationRecord } from '../lib/arkiv'

/**
 * Prova della Mission 02, dal vivo.
 *
 * La stessa identica query gira a intervalli: prima della scadenza restituisce
 * l'entità, dopo non restituisce nulla. Nessuna chiamata di Delete, nessun job:
 * a cambiare è solo il fatto che il blocco di scadenza è passato.
 *
 * Si fa POLLING e non una sleep: dormire esattamente 60 s e interrogare una
 * volta sola può cadere dal lato sbagliato del confine. Così registriamo il
 * PRIMO blocco in cui l'entità sparisce, che è anche una prova migliore.
 */
const POLL_MS = 4000

type Observation = {
  atBlock: bigint
  present: boolean
  at: Date
}

export function ArkivRecordPanel({ documentHash }: { documentHash: string }) {
  const [record, setRecord] = useState<NotarizationRecord | null>(null)
  const [head, setHead] = useState<bigint | null>(null)
  const [observations, setObservations] = useState<Observation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const timerRef = useRef<number | null>(null)

  const poll = useCallback(async () => {
    try {
      const [currentHead, found] = await Promise.all([
        getHead(),
        findByDocumentHash(documentHash),
      ])
      const present = found.length > 0
      setHead(currentHead)
      setRecord(present ? found[0] : null)
      setError(null)
      setObservations((prev) => {
        // Si annota solo un CAMBIO di stato: la riga che interessa è quella
        // in cui l'entità smette di essere restituita.
        const last = prev[prev.length - 1]
        if (last && last.present === present) return prev
        return [...prev, { atBlock: currentHead, present, at: new Date() }]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query Arkiv fallita.')
    }
  }, [documentHash])

  useEffect(() => {
    void poll()
  }, [poll])

  useEffect(() => {
    if (!isPolling) return
    timerRef.current = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [isPolling, poll])

  const blocksLeft =
    record?.expiresAtBlock !== undefined && head !== null
      ? record.expiresAtBlock - head
      : null

  return (
    <section className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Indice Arkiv (Mission 02)</h3>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            record
              ? 'border-neutral-900 text-neutral-900'
              : 'border-neutral-200 text-neutral-500'
          }`}
        >
          {record ? 'presente nell’indice' : 'non nell’indice'}
        </span>
      </div>

      {!ARKIV_CREATOR_ADDRESS && (
        <p className="mt-3 text-xs text-neutral-500">
          VITE_ARKIV_CREATOR_ADDRESS non configurato: la query non è ancorata a
          createdBy(), quindi potrebbe restituire entità scritte da altri.
        </p>
      )}

      {error ? (
        <p className="mt-3 text-xs text-neutral-500">{error}</p>
      ) : record ? (
        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-neutral-500">Entity key</dt>
            <dd className="break-all font-mono text-neutral-700">
              {record.entityKey}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-neutral-500">Scade al blocco</dt>
            <dd className="font-mono text-neutral-700">
              {record.expiresAtBlock?.toString() ?? 'n/d'}
              {blocksLeft !== null && (
                <span className="ml-2 text-neutral-400">
                  {blocksLeft > 0n
                    ? `fra ${blocksLeft.toString()} blocchi (~${Math.round(Number(blocksLeft) * 2)} s)`
                    : 'scaduto'}
                </span>
              )}
            </dd>
          </div>
          {record.payload?.tx_hash != null && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-neutral-500">Ancora RWA</dt>
              <dd className="break-all font-mono text-neutral-700">
                {String(record.payload.tx_hash)}
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">
          La query non restituisce l’entità. Se prima c’era, è scaduta da sola:
          nessuna chiamata di Delete è stata mai effettuata.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setIsPolling((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white"
        >
          {isPolling ? (
            <>
              <Spinner className="h-3.5 w-3.5" />
              Polling attivo…
            </>
          ) : (
            'Osserva la scadenza'
          )}
        </button>
        <button
          type="button"
          onClick={() => void poll()}
          className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
        >
          esegui la query ora
        </button>
        {head !== null && (
          <span className="ml-auto font-mono text-[11px] text-neutral-400">
            head {head.toString()}
          </span>
        )}
      </div>

      {observations.length > 0 && (
        <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-[11px] font-medium text-neutral-500">
            Transizioni osservate — stessa query, nessun Delete
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-neutral-700">
            {observations.map((o) => (
              <li key={o.atBlock.toString()}>
                blocco {o.atBlock.toString()} · {o.at.toLocaleTimeString()} ·{' '}
                {o.present ? 'presente' : 'NON restituita'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
