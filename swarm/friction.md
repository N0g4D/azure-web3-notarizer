# Swarm friction report — Ancorhash @ ETHRome 2026

Field notes on building with Swarm ID. Separate from `arkiv/friction.md`
because the two sponsors are separate: nothing here is an Arkiv issue.

The Swarm bounty does not ask for a friction report. We keep one anyway — the
issues below cost us hours and are cheap for the Swarm team to fix.

- **Team / project:** Ancorhash — Confidential RWA Vault
- **SDK:** `@snaha/swarm-id@0.4.0`
- **Identity UI:** https://swarm-id.snaha.net
- **Opened:** 2026-09-12, after Phase 1 was verified end to end

**What worked:** once an identity with a usable stamp was connected, the
encrypted upload did exactly what the README promises. The document is
encrypted in the browser, only opaque bytes reach Swarm, and the 128-hex
reference carries its own decryption key so the backend never sees it. No Bee
node, no xBZZ, no onboarding before the first line of code. That part is
genuinely excellent.

---

## S-01 · Swarm ID sign-in accepts only a seed phrase

**Severity:** high — it silently invalidates the documented on-ramp for a
hackathon gift code.

The ETHRome manual describes Swarm ID as an identity layer where *"your users
sign in with a passkey or an Ethereum account"* (`manual/prizes.md:162`). In
the UI we used, sign-in accepts **a seed phrase and nothing else**: there is no
option to connect an Ethereum account and no way to import a raw private key.

That matters because the gift code handed out at the Swarm desk is a QR whose
payload is a private key plus a batch id:

```json
{"v":1,"pk":"0x…","batch":"0x…"}
```

The key owns the postage batch — we confirmed that on Gnosis, deriving the
address from the key and matching it against the `batches(bytes32)` owner on
the PostageStamp contract `0x45a1502382541cd610cc9068e88727426b696293`. But
with no way to turn that key into a Swarm ID identity, **the gift code cannot
be used as the signing identity at all.** We spent a long time assuming we had
mis-scanned the QR or mis-read the docs.

**Suggestion:** either support importing a private key / connecting an Ethereum
account as the manual describes, or make the gift-code flow explicit — say in
the docs that the code funds storage for an identity you create from a seed
phrase, rather than being an identity itself.

---

## S-02 · `canUpload` is true without a usable stamp, and the failure arrives 30 s later as a timeout

**Severity:** high — the SDK reports readiness it has not verified.

`ConnectionInfo.canUpload` was `true` while the connected identity had no
stamp it could actually use. We gated our entire UI on that flag, exactly as
the README example does:

```ts
if (info.identity && info.canUpload) {
  const result = await client.uploadData(bytes)
}
```

The upload then hung and surfaced roughly **30 seconds later as an opaque
timeout**, with nothing pointing at the real cause. `uploadUnavailableReason`
never fired, because from the SDK's point of view there was nothing to report.

The information needed to answer the question correctly is already in the SDK:
`getPostageBatch()` returns a `PostageBatch` carrying `exists` and `usable`.
`canUpload` appears not to consult it.

**Expected:** `canUpload` is false, with `uploadUnavailableReason: "no-stamp"`,
before any upload is attempted — or the upload fails immediately with a
missing-stamp error rather than a timeout.

**Observed:** `canUpload: true`, then a ~30 s hang, then a generic timeout.

**Workaround, now in our code:** we no longer trust `canUpload` on its own. The
UI calls `getPostageBatch()` and requires `exists && usable` before it reports
storage as ready, and it shows the active identity and the batch id next to
that verdict. A readiness flag that can be wrong is worse than no flag, because
it moves the failure from setup time to upload time.

---

## S-03 · The public gateway answers 200 with its own page for any address

**Severity:** medium — a failed retrieval is indistinguishable from a success.

`https://gateway.ethswarm.org/bzz/<address>/` returns **HTTP 200** with a
960-byte HTML shell for anything it cannot resolve. Not a 404, not a 5xx, and
no header that distinguishes the two.

**Reproduce** — three addresses, including all-zeroes, all identical:

```bash
for h in 959daf94110f4e2ec69c1ebd7a5182489d3f06aa1384e215b4cf859822a4cfe8 \
         0000000000000000000000000000000000000000000000000000000000000000 \
         ababababababababababababababababababababababababababababababababab; do
  curl -sL -o /tmp/x -w "%{http_code} %{size_download}\n" \
    "https://gateway.ethswarm.org/bzz/$h/"
done
# 200 960
# 200 960
# 200 960   <- byte-identical HTML, Content-Type: text/html
```

**Why it matters for us.** Our verify page takes a 128-hex reference and opens
the document. Opening blindly means a viewer with a wrong, truncated or
expired reference lands on an anonymous error page and concludes the *product*
is broken. During a demo that is the worst possible failure.

**Workaround, now in the code:** fetch first and treat a `text/html` response
as unresolved, since a real upload carries its own content type. It works, but
it is a heuristic — a genuinely HTML-typed document would be misreported — and
we would rather branch on a status code.

**Suggestion:** return 404 for an unresolvable address, or set a header the
client can read. Either removes the guesswork.

**Also observed:** the public gateway is read-only. `POST /bzz` with a valid
`swarm-postage-batch-id` returns **405**, so uploads must go through Swarm ID
or a Bee node — reasonable, but it is not stated where a developer meets it.

**Observed:** 2026-09-13, `gateway.ethswarm.org`.

---

## Still to come

- [ ] Behaviour when a batch expires mid-session
- [ ] Whether `utilization` approaching capacity is reported before uploads fail
