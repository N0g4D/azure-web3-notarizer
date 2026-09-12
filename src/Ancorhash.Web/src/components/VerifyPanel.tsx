import { Fragment, useCallback, useEffect, useState } from 'react'
import { FileDropzone } from './FileDropzone'
import { Spinner } from './Spinner'
import { sha256Hex } from '../lib/hash'
import {
  ARKIV_CREATOR_ADDRESS,
  findByDocumentHash,
  queryRegistry,
} from '../lib/arkiv'
import type { NotarizationRecord } from '../lib/arkiv'

/**
 * The auditor's view of the registry.
 *
 * Everything here runs in the browser against the public Arkiv index: no
 * backend, no API key, no account. That is the point — the README argues a
 * notarization registry is only worth something to a verifier who does not
 * trust the operator, so a third party has to be able to read it without
 * asking us for anything.
 *
 * Browsing comes first and matching a file second, because the two serve
 * different people. An auditor does not hold the documents: they hold a
 * question ("what did this organisation register, and when?") and the index is
 * the only thing that can answer it. Only a counterparty who already received
 * a copy needs the digest check, so that is a secondary affordance rather than
 * the landing flow.
 */

const EXPLORER_TX = 'https://testnet.snowtrace.io/tx/'
const BLOCKS_PER_DAY = 43_200n

const WINDOWS = [
  { label: 'Any time', days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last year', days: 365 },
] as const

type RegistryState =
  | { kind: 'loading' }
  | { kind: 'ready'; records: NotarizationRecord[]; head: bigint }
  | { kind: 'error'; message: string }

type MatchState =
  | { kind: 'idle' }
  | { kind: 'checking'; label: string }
  | { kind: 'found'; hash: string; record: NotarizationRecord }
  | { kind: 'absent'; hash: string }
  | { kind: 'error'; message: string }

function formatDate(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function expiryLabel(record: NotarizationRecord, head: bigint): string {
  if (record.expiresAtBlock === undefined) return '—'
  const left = record.expiresAtBlock - head
  if (left <= 0n) return 'lapsed'
  const days = Number(left / BLOCKS_PER_DAY)
  if (days >= 1) return `${days}d`
  const minutes = Math.round((Number(left) * 2) / 60)
  return minutes >= 1 ? `${minutes}m` : `${Number(left) * 2}s`
}

/** Full proofs for one record, opened from the register row. */
function RecordDetail({
  record,
  head,
}: {
  record: NotarizationRecord
  head: bigint
}) {
  const tx = record.payload?.tx_hash as string | undefined
  return (
    <dl className="space-y-1.5 border-l-2 border-neutral-200 py-1 pl-4 text-xs">
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-neutral-500">Document digest</dt>
        <dd className="min-w-0 break-all font-mono text-neutral-700">
          {record.documentHash ?? '—'}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-neutral-500">Swarm address</dt>
        <dd className="min-w-0 break-all font-mono text-neutral-700">
          {record.swarmAddress ?? '—'}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-neutral-500">Arkiv entity</dt>
        <dd className="min-w-0 break-all font-mono text-neutral-700">
          {record.entityKey}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-neutral-500">Index lapses</dt>
        <dd className="text-neutral-700">
          block {record.expiresAtBlock?.toString() ?? '—'}
          <span className="ml-2 text-neutral-400">
            ({expiryLabel(record, head)} left)
          </span>
        </dd>
      </div>
      {tx && (
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-neutral-500">RWA anchor</dt>
          <dd className="min-w-0 break-all">
            <a
              href={`${EXPLORER_TX}${tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
            >
              {tx}
            </a>
          </dd>
        </div>
      )}
      <p className="pt-1 text-[11px] leading-relaxed text-neutral-400">
        The document itself is not here. It stays encrypted on Swarm, and its
        decryption key never left the browser that uploaded it. What this record
        proves is a commitment: this digest was registered, by this creator, at
        this time.
      </p>
    </dl>
  )
}

export function VerifyPanel() {
  // --- registry (primary) -------------------------------------------------
  const [state, setState] = useState<RegistryState>({ kind: 'loading' })
  const [org, setOrg] = useState('')
  const [docType, setDocType] = useState('')
  const [windowDays, setWindowDays] = useState(0)
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const { head, records } = await queryRegistry({
        org: org.trim() || undefined,
        docType: docType.trim() || undefined,
        sinceMs:
          windowDays > 0 ? Date.now() - windowDays * 86_400_000 : undefined,
        expiringWithinBlocks: expiringOnly ? BLOCKS_PER_DAY : undefined,
      })
      setState({ kind: 'ready', records, head })
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Arkiv query failed.',
      })
    }
  }, [docType, expiringOnly, org, windowDays])

  useEffect(() => {
    void load()
    // Only on mount: filters are applied by the Apply button, so a keystroke
    // does not fire a chain of queries against a rate-limited public RPC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- match a copy (secondary) -------------------------------------------
  const [matchOpen, setMatchOpen] = useState(false)
  const [match, setMatch] = useState<MatchState>({ kind: 'idle' })
  const [digest, setDigest] = useState('')

  const lookup = useCallback(async (hash: string, label: string) => {
    setMatch({ kind: 'checking', label })
    try {
      const records = await findByDocumentHash(hash)
      setMatch(
        records.length > 0
          ? { kind: 'found', hash, record: records[0] }
          : { kind: 'absent', hash },
      )
    } catch (e) {
      setMatch({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Arkiv query failed.',
      })
    }
  }, [])

  const onFile = useCallback(
    async (file: File) => {
      setMatch({ kind: 'checking', label: file.name })
      try {
        await lookup(await sha256Hex(file), file.name)
      } catch {
        setMatch({ kind: 'error', message: 'Unable to read the selected file.' })
      }
    },
    [lookup],
  )

  const isDigestValid = /^[0-9a-fA-F]{64}$/.test(digest.trim())
  const head = state.kind === 'ready' ? state.head : 0n

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Notarization registry
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          Every notarization Ancorhash has registered, queried live from the
          public Arkiv index. This page talks to the chain directly from your
          browser — no account, no API key, and nothing routed through
          Ancorhash. You are not taking our word for any of it.
        </p>
      </div>

      {/* Filters — each one is a predicate over a typed, indexed attribute */}
      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="f-org" className="text-xs font-medium text-neutral-500">
              Organisation
            </label>
            <input
              id="f-org"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="all organisations"
              className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-xs text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="f-type" className="text-xs font-medium text-neutral-500">
              Document type
            </label>
            <input
              id="f-type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder="all types"
              className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-xs text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="f-window" className="text-xs font-medium text-neutral-500">
              Notarized
            </label>
            <select
              id="f-window"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className="mt-1.5 w-full cursor-pointer rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none"
            >
              {WINDOWS.map((w) => (
                <option key={w.days} value={w.days}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={expiringOnly}
              onChange={(e) => setExpiringOnly(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-neutral-300 accent-black"
            />
            Only records lapsing within 24 h
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Apply filters
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
          One compound query over typed attributes:{' '}
          <span className="font-mono">org</span> and{' '}
          <span className="font-mono">doc_type</span> by equality,{' '}
          <span className="font-mono">notarized_at</span> by an ordered range —
          possible only because it is stored as{' '}
          <span className="font-mono">u64</span>. Anchored on{' '}
          <span className="font-mono">createdBy()</span>, so entities written by
          anyone else cannot appear here. The lapsing filter is applied after
          records are collapsed per document, because a document&rsquo;s real
          expiry is the latest of its entries and a server-side range would
          flag one that has already been superseded.
        </p>
      </section>

      {/* The register */}
      {state.kind === 'loading' && (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 px-5 py-6 text-sm text-neutral-600">
          <Spinner className="h-4 w-4" />
          Querying the Arkiv index…
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          {state.message}
        </div>
      )}

      {state.kind === 'ready' && state.records.length === 0 && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-50 px-5 py-6 text-sm leading-relaxed text-neutral-700">
          <strong>No records returned.</strong> Either nothing matches these
          filters, or the matching records have lapsed — Arkiv entities carry
          their own lifetime, and an expired one stops being returned without
          anyone deleting it.
        </div>
      )}

      {state.kind === 'ready' && state.records.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">
              {state.records.length} record{state.records.length === 1 ? '' : 's'}
            </h3>
            <span className="font-mono text-[11px] text-neutral-400">
              head {state.head.toString()}
            </span>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Organisation</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Notarized</th>
                  <th className="px-4 py-2 font-medium">Digest</th>
                  <th className="px-4 py-2 font-medium">Lapses</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {state.records.map((r) => {
                  const isOpen = openKey === r.entityKey
                  return (
                    <Fragment key={r.entityKey}>
                      <tr
                        className="cursor-pointer border-t border-neutral-200 hover:bg-neutral-50"
                        onClick={() => setOpenKey(isOpen ? null : r.entityKey)}
                      >
                        <td className="px-4 py-2.5 font-medium text-neutral-900">
                          {r.org ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-neutral-700">
                          {r.docType ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-neutral-700">
                          {formatDate(r.notarizedAt)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-neutral-500">
                          {r.documentHash?.slice(0, 10) ?? '—'}…
                        </td>
                        <td className="px-4 py-2.5 text-neutral-700">
                          {expiryLabel(r, state.head)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-neutral-400">
                          {isOpen ? '−' : '+'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-neutral-200 bg-neutral-50">
                          <td colSpan={6} className="px-4 py-3">
                            <RecordDetail record={r} head={state.head} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Secondary: the counterparty who already holds a copy */}
      <section className="rounded-lg border border-neutral-200 p-5">
        <button
          type="button"
          onClick={() => setMatchOpen((v) => !v)}
          className="flex w-full items-baseline justify-between text-left"
        >
          <h3 className="text-sm font-semibold">
            Hold a copy of a document? Check that it matches
          </h3>
          <span className="text-neutral-400">{matchOpen ? '−' : '+'}</span>
        </button>
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          For whoever received the file itself — a client checking an invoice
          against the register. The file is hashed in this page and never
          uploaded; only the digest is used as a lookup key.
        </p>

        {matchOpen && (
          <div className="mt-4 space-y-4">
            <FileDropzone onFileSelected={(f) => void onFile(f)} />

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="digest" className="text-xs font-medium text-neutral-500">
                  …or paste a SHA-256 digest
                </label>
                <input
                  id="digest"
                  value={digest}
                  onChange={(e) => setDigest(e.target.value)}
                  placeholder="64 hex characters"
                  className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none"
                />
              </div>
              <button
                type="button"
                disabled={!isDigestValid}
                onClick={() => void lookup(digest.trim(), 'pasted digest')}
                className="rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Check
              </button>
            </div>

            {match.kind === 'checking' && (
              <div className="flex items-center gap-3 text-sm text-neutral-600">
                <Spinner className="h-4 w-4" />
                Hashing {match.label} and querying Arkiv…
              </div>
            )}

            {match.kind === 'error' && (
              <p className="text-sm text-neutral-700">{match.message}</p>
            )}

            {match.kind === 'absent' && (
              <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
                <p className="text-sm font-semibold">No matching record</p>
                <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">
                  {match.hash}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-neutral-700">
                  This exact file does not correspond to any record currently in
                  the index. It was either never notarized, altered since, or
                  its record has lapsed.
                </p>
              </div>
            )}

            {match.kind === 'found' && (
              <div className="rounded-lg border border-neutral-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">This file matches a record</p>
                  <span className="shrink-0 rounded-full border border-neutral-900 px-2.5 py-0.5 text-[11px] font-medium">
                    verified
                  </span>
                </div>
                <p className="mt-2 text-xs text-neutral-700">
                  {match.record.org ?? '—'} · {match.record.docType ?? '—'} ·{' '}
                  {formatDate(match.record.notarizedAt)}
                </p>
                <div className="mt-3">
                  <RecordDetail record={match.record} head={head} />
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {!ARKIV_CREATOR_ADDRESS && (
        <p className="text-xs text-neutral-500">
          VITE_ARKIV_CREATOR_ADDRESS is not set: queries are not anchored on
          createdBy(), so they may return entities written by someone else.
        </p>
      )}
    </div>
  )
}
