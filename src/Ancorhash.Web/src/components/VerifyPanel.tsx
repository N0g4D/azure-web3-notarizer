import { useCallback, useState } from 'react'
import { FileDropzone } from './FileDropzone'
import { Spinner } from './Spinner'
import { sha256Hex } from '../lib/hash'
import {
  ARKIV_CREATOR_ADDRESS,
  findByDocumentHash,
  findByOrgSince,
  getHead,
} from '../lib/arkiv'
import type { NotarizationRecord } from '../lib/arkiv'

/**
 * Third-party verification, which is the point of the whole product.
 *
 * Everything here runs in the browser against the public Arkiv index: no
 * backend, no API key, no account. That is deliberate — the README argues
 * that a notarization registry is only worth something to a verifier who does
 * not trust the operator, so the verifier must be able to check a document
 * without asking us for anything.
 *
 * The file never leaves the page: it is hashed locally and only the digest is
 * used as a query key.
 */

const EXPLORER_TX = 'https://testnet.snowtrace.io/tx/'

type Result =
  | { kind: 'idle' }
  | { kind: 'checking'; label: string }
  | { kind: 'found'; hash: string; records: NotarizationRecord[]; head: bigint }
  | { kind: 'absent'; hash: string; head: bigint }
  | { kind: 'error'; message: string }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-all text-neutral-700">{children}</dd>
    </div>
  )
}

export function VerifyPanel() {
  const [result, setResult] = useState<Result>({ kind: 'idle' })
  const [hashInput, setHashInput] = useState('')
  const [org, setOrg] = useState('acme-spa')
  const [orgResult, setOrgResult] = useState<NotarizationRecord[] | null>(null)
  const [orgBusy, setOrgBusy] = useState(false)

  const lookup = useCallback(async (hash: string, label: string) => {
    setResult({ kind: 'checking', label })
    try {
      const [records, head] = await Promise.all([
        findByDocumentHash(hash),
        getHead(),
      ])
      setResult(
        records.length > 0
          ? { kind: 'found', hash, records, head }
          : { kind: 'absent', hash, head },
      )
    } catch (e) {
      setResult({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Arkiv query failed.',
      })
    }
  }, [])

  const onFile = useCallback(
    async (file: File) => {
      setResult({ kind: 'checking', label: file.name })
      try {
        const hash = await sha256Hex(file)
        await lookup(hash, file.name)
      } catch {
        setResult({ kind: 'error', message: 'Unable to read the selected file.' })
      }
    },
    [lookup],
  )

  const searchOrg = useCallback(async () => {
    setOrgBusy(true)
    try {
      const since = Date.now() - 30 * 86_400_000
      setOrgResult(await findByOrgSince(org.trim(), since))
    } catch {
      setOrgResult([])
    } finally {
      setOrgBusy(false)
    }
  }, [org])

  const isHashValid = /^[0-9a-fA-F]{64}$/.test(hashInput.trim())

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Verify a document</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          Check whether a document was notarized, and when. This runs entirely
          in your browser against the public Arkiv index — no account, no API
          key, and nothing sent to Ancorhash. The file is hashed locally and
          never uploaded.
        </p>
      </div>

      <FileDropzone onFileSelected={(f) => void onFile(f)} />

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor="hash-input"
            className="text-xs font-medium text-neutral-500"
          >
            …or paste a SHA-256 digest
          </label>
          <input
            id="hash-input"
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            placeholder="64 hex characters"
            className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
        </div>
        <button
          type="button"
          disabled={!isHashValid}
          onClick={() => void lookup(hashInput.trim(), 'pasted digest')}
          className="rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Look up
        </button>
      </div>

      {result.kind === 'checking' && (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 px-5 py-6 text-sm text-neutral-600">
          <Spinner className="h-4 w-4" />
          Hashing {result.label} and querying Arkiv…
        </div>
      )}

      {result.kind === 'error' && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          {result.message}
        </div>
      )}

      {result.kind === 'absent' && (
        <section className="rounded-lg border border-neutral-300 bg-neutral-50 p-5">
          <h3 className="text-sm font-semibold">Not in the index</h3>
          <p className="mt-2 break-all font-mono text-xs text-neutral-500">
            {result.hash}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-neutral-700">
            No notarization for this digest is currently returned by the index.
            Either it was never notarized, or its record has expired — Arkiv
            entities carry their own lifetime, and an expired one stops being
            returned without anyone deleting it.
          </p>
        </section>
      )}

      {result.kind === 'found' &&
        result.records.map((r) => {
          const blocksLeft =
            r.expiresAtBlock !== undefined ? r.expiresAtBlock - result.head : null
          const tx = r.payload?.tx_hash as string | undefined
          return (
            <section
              key={r.entityKey}
              className="rounded-lg border border-neutral-900 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Notarization found</h3>
                <span className="shrink-0 rounded-full border border-neutral-900 px-2.5 py-0.5 text-[11px] font-medium">
                  verified
                </span>
              </div>
              <dl className="mt-4 space-y-1.5 text-xs">
                <Row label="Document digest">
                  <span className="font-mono">{result.hash}</span>
                </Row>
                <Row label="Organisation">{r.org ?? '—'}</Row>
                <Row label="Document type">{r.docType ?? '—'}</Row>
                <Row label="Notarized at">
                  {r.notarizedAt
                    ? new Date(r.notarizedAt).toLocaleString()
                    : '—'}
                </Row>
                <Row label="Swarm address">
                  <span className="font-mono">{r.swarmAddress ?? '—'}</span>
                </Row>
                <Row label="Arkiv entity">
                  <span className="font-mono">{r.entityKey}</span>
                </Row>
                <Row label="Index expires">
                  {r.expiresAtBlock?.toString() ?? '—'}
                  {blocksLeft !== null && blocksLeft > 0n && (
                    <span className="ml-2 text-neutral-400">
                      in {blocksLeft.toString()} blocks (~
                      {Math.round(Number(blocksLeft) * 2)} s)
                    </span>
                  )}
                </Row>
                {tx && (
                  <Row label="RWA anchor">
                    <a
                      href={`${EXPLORER_TX}${tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono underline underline-offset-2 hover:text-neutral-900"
                    >
                      {tx}
                    </a>
                  </Row>
                )}
              </dl>
              <p className="mt-4 text-[11px] leading-relaxed text-neutral-400">
                The document itself is not here. It stays encrypted on Swarm,
                and its decryption key never left the browser that uploaded it.
                What you just verified is a commitment: this digest was
                registered, by this creator, at this time.
              </p>
            </section>
          )
        })}

      {/* Compound query: the one that justifies typed attributes */}
      <section className="rounded-lg border border-neutral-200 p-5">
        <h3 className="text-sm font-semibold">Browse an organisation's records</h3>
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          A compound query over typed attributes — organisation, document type
          and a date window on <span className="font-mono">notarized_at</span>,
          anchored on <span className="font-mono">createdBy()</span> so entities
          written by anyone else cannot appear here.
        </p>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="org-input" className="text-xs font-medium text-neutral-500">
              Organisation slug · invoices from the last 30 days
            </label>
            <input
              id="org-input"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs text-neutral-900 transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void searchOrg()}
            disabled={orgBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:opacity-40"
          >
            {orgBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
            Search
          </button>
        </div>
        {orgResult !== null && (
          <p className="mt-3 text-xs text-neutral-700">
            {orgResult.length === 0
              ? 'No records returned for that organisation in the window.'
              : `${orgResult.length} record(s):`}
          </p>
        )}
        {orgResult !== null && orgResult.length > 0 && (
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-neutral-600">
            {orgResult.map((r) => (
              <li key={r.entityKey} className="break-all">
                {r.docType} · {r.documentHash?.slice(0, 18)}… ·{' '}
                {r.notarizedAt ? new Date(r.notarizedAt).toLocaleDateString() : '—'}
              </li>
            ))}
          </ul>
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
