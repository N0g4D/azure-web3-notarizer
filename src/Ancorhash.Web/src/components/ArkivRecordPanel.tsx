import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from './Spinner'
import { ARKIV_CREATOR_ADDRESS, findByDocumentHash, getHead } from '../lib/arkiv'
import type { NotarizationRecord } from '../lib/arkiv'
import type { NotarizeResponse } from '../lib/api'

/**
 * The Mission 02 proof, live.
 *
 * The exact same query runs on an interval: before expiry it returns the
 * entity, after it returns nothing. No Delete call, no job — the only thing
 * that changed is that the expiry block went past.
 *
 * It POLLS rather than sleeping: sleeping exactly 60 s and querying once can
 * land on the wrong side of the boundary. Polling records the FIRST block at
 * which the entity disappears, which is also better evidence.
 */
const POLL_MS = 4000

type Observation = {
  atBlock: bigint
  present: boolean
  at: Date
}

export function ArkivRecordPanel({
  documentHash,
  result,
}: {
  documentHash: string
  result: NotarizeResponse
}) {
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
        // Only a CHANGE of state is recorded: the row that matters is the one
        // where the entity stops being returned.
        const last = prev[prev.length - 1]
        if (last && last.present === present) return prev
        return [...prev, { atBlock: currentHead, present, at: new Date() }]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Arkiv query failed.')
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

  // If the write failed there is nothing to observe: rendering it as "not in
  // the index" would be indistinguishable from a genuine expiry, and in a demo
  // that makes the Mission 02 proof unreadable.
  if (!result.arkiv_indexed) {
    return (
      <section className="rounded-lg border border-neutral-400 bg-neutral-50 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Arkiv index</h3>
          <span className="shrink-0 rounded-full border border-neutral-400 px-2.5 py-0.5 text-[11px] font-medium text-neutral-700">
            INDEXING FAILED
          </span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-neutral-700">
          The Arkiv entity was never created, so there is no expiry to
          observe. This is <strong>not</strong> the Mission 02 case: there the
          entity exists and disappears on its own.
        </p>
        {result.arkiv_error && (
          <p className="mt-3 break-words rounded-md border border-neutral-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-neutral-700">
            {result.arkiv_error_code && (
              <span className="font-semibold">[{result.arkiv_error_code}] </span>
            )}
            {result.arkiv_error}
          </p>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          The notarization is still VALID: the on-chain anchor exists
          (tx {result.tx_hash.slice(0, 12)}…). The index can be rebuilt without
          touching the chain.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Arkiv index — Mission 02</h3>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            record
              ? 'border-neutral-900 text-neutral-900'
              : 'border-neutral-200 text-neutral-500'
          }`}
        >
          {record ? 'in the index' : 'not returned'}
        </span>
      </div>

      {!ARKIV_CREATOR_ADDRESS && (
        <p className="mt-3 text-xs text-neutral-500">
          VITE_ARKIV_CREATOR_ADDRESS is not set: the query is not anchored on
          createdBy(), so it may return entities written by someone else.
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
            <dt className="w-32 shrink-0 text-neutral-500">Expires at block</dt>
            <dd className="font-mono text-neutral-700">
              {record.expiresAtBlock?.toString() ?? 'n/d'}
              {blocksLeft !== null && (
                <span className="ml-2 text-neutral-400">
                  {blocksLeft > 0n
                    ? `in ${blocksLeft.toString()} blocks (~${Math.round(Number(blocksLeft) * 2)} s)`
                    : 'expired'}
                </span>
              )}
            </dd>
          </div>
          {record.payload?.tx_hash != null && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-neutral-500">RWA anchor</dt>
              <dd className="break-all font-mono text-neutral-700">
                {String(record.payload.tx_hash)}
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-neutral-700">
          The same query no longer returns the entity.{' '}
          {observations.some((o) => o.present)
            ? 'IT EXPIRED ON ITS OWN — no Delete call was ever made.'
            : 'The entity was written successfully, so it has either expired already or is not indexed yet: leave the polling running.'}
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
              Polling…
            </>
          ) : (
            'Watch it expire'
          )}
        </button>
        <button
          type="button"
          onClick={() => void poll()}
          className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
        >
          run the query now
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
            Observed transitions — same query, no Delete call
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-neutral-700">
            {observations.map((o) => (
              <li key={o.atBlock.toString()}>
                block {o.atBlock.toString()} · {o.at.toLocaleTimeString()} ·{' '}
                {o.present ? 'returned' : 'NOT returned'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
