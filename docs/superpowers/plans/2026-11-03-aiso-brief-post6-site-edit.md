# AISO brief — post–Stage 6: site-edit (act/edit on the brand's own website)

> **Scoping brief.** Willy decided on 2026-11-03: **option E (executor hand-off)**,
> **JSON-LD first**, **no new flag**, and answered **Q1**: **Rick is a Fimmick dev
> agency**; jobs go by **webhook**; completions come back as **signed receipts**.
> S1 is in [YNWAforever/aiso#143](https://github.com/YNWAforever/aiso/pull/143).
> S2/S3 follow the contract in §3a once Rick agrees it and Willy names a start.
> Draft PRs only. Never merge.

| | |
| --- | --- |
| ClickUp | [z8qgvcahq6](https://app.clickup.com/t/z8qgvcahq6). Third and last in the post–Stage 6 sequence: honesty rename z8qgvcahq4 (#140, merged) → Drive/Docs z8qgvcahq5 (#141 merged, #142 open) → **this**. |
| Base when written | `main@041d3bf56f43d4b201890bedbde1919bc1dd48c0` (#141) |
| Design (LOCKED) | `/workspace/docs/superpowers/specs/2026-11-02-aiso-post-stage6-plan-packaged-vs-operator-mcp-design.md`: Willy answering Luna **t223s832** (direction t221u) |
| Lane | **待確認** |
| Assembled | 2026-11-03 from `main@041d3bf5`, the dev pack §D3, and the C9c–C9f specs in `docs/superpowers/specs/`. Where this differs from the locked design, the design wins. |

## 0. What the lock says (quote, don't paraphrase)

From the LOCKED post–Stage 6 design (t223s832), as carried in the dev pack §D3:

- «*MCP path* (operator tools to **act／edit** on owned workflows — **Google Drive／Google Docs first**; **later Rick work pass／Rap FED for site-edit + Google properties**).»
- «MCP = **act／edit**, **not** scrape／SERP／「攞資料」.»
- Sequenced: «… → backlog site-edit [z8qgvcahq6] (**named Approve before spend/scope**).»
- Open question the design leaves: «**Rick/Rap FED products + auth 待核實**».
- Non-goals: «inventing vendor $; customer MCP for SERP/scrape; Prod LIVE/cap/FEATURE/Neon flips; **unbounded "change any website"**; SME/Kinnso work.»

UI rule (AGENTS.md, t342s1437): «Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.»

## 1. What already exists (verified on `041d3bf5`)

Site-edit is the missing last step of a chain that is already built:

| Step | Built in | What it gives site-edit |
| --- | --- | --- |
| Evidence-linked work-item drafts | C9c (`lib/work-items/`) | What to change, tied to saved evidence |
| Immutable, hashed review versions + independent approval | C9d (`lib/change-sets/`, migration `042`) | **The only acceptable input**: an approved version with a content hash. Submitters can't approve themselves; platform admins get no bypass. |
| Approved-package export + **manual** delivery attestation | C9e (`lib/delivery/`, `043`) | Today, "delivered" is the member's self-report. C9e's spec explicitly deferred the alternative: «A CMS connector could verify publication but adds provider ownership, scopes, credentials and remote-write requirements outside this scope.» **Site-edit is that connector.** |
| Stored-evidence outcome windows (D7/D28/D56) | C9f (`lib/outcomes/`) | Anchored on the delivery time. A provider receipt would make that anchor verified rather than self-reported. |
| Act/edit connection pattern | Drive PR 1/2 (#141, #142) | Per-profile OAuth, a token sealed with a per-purpose vault AAD, single-attempt writes, an "unknown outcome" state, an insert-only ledger, "never 2xx over a failed write" |
| Domain ownership check | Search Console binding (`lib/integrations/search-console/binding.ts`) | A connection binds only if it covers the brand's domain (`clients.domain`) |
| SSRF guard | `lib/security/public-url.ts` | DNS-pinned public fetch for verifying a live page afterwards |

**The gap that shapes everything.** A C9d version's content is prose:
`{ title, action, notes, locale }` plus evidence snapshot(s)
(`lib/change-sets/types.ts`). Nothing in it can be applied to a website
mechanically. Site-edit therefore needs a new, **structured, reviewable edit
spec** that is itself part of the approved version. Without that, "apply the
approved change" would mean an LLM improvising edits on a live site, which is
exactly the «unbounded "change any website"» the lock forbids.

## 2. Decisions

**Decided by Willy, 2026-11-03: Q2 = E (executor hand-off), Q4 = JSON-LD first, Q7 = no new flag.**
Still open: **Q1 (blocking for S2+)**, Q3, Q5, Q6. The options are kept below for the record.

**Q1 — Answered (Willy, 2026-11-03): Rick is a Fimmick dev agency** and is the
executor. Hand-off is a **webhook**; completion comes back as a **signed receipt**.
"Rap FED" is not yet defined; it is out of S2–S4 until named. The original
question is kept below.

**Q1 (original) — What are "Rick work pass" and "Rap FED"?** They appear only in the lock's
one line. Nothing in the repo, the dev pack or the specs defines them. Before
anything else we need:
- What each one is: Fimmick-internal tools, a client delivery service, or third-party products.
- Whether they are the **target** (AISO writes into them) or the **executor** (they do the edit and report back to AISO).
- Their auth model.

If they are human delivery workflows, site-edit may be "hand an approved,
structured edit spec to Rick/Rap FED and ingest their completion receipt", with
no AISO credential on the client's site at all. That is the safest shape (option E
in Q2).

**Q2 — Which site surface first?** Options, all bounded to the brand's own verified domain:

| Option | How AISO acts | Credential AISO holds | Main risk |
| --- | --- | --- | --- |
| A. WordPress REST | Creates a **draft** revision of one page/post | Application password or OAuth plugin, per site | Plugin/theme variance; site-wide credential |
| B. Git-backed site (GitHub/GitLab) | Opens a **pull request** against the site repo | GitHub App installation, scoped to one repo | Only fits sites built from a repo |
| C. Headless CMS (Webflow / Contentful / Sanity / Shopify pages) | Creates a draft entry/page version | Per-platform OAuth/API token | One adapter per platform |
| D. Snippet / tag (one AISO-hosted JSON-LD or llms.txt endpoint the site includes once) | Serves the approved content; the site pulls it | None on the site | AISO becomes part of the client's page delivery path; uptime and trust |
| **E. Executor hand-off (Rick work pass／Rap FED, if Q1 confirms)** | Sends the approved edit spec to the executor; ingests a signed completion receipt | None on the site | Depends on Q1; receipt authenticity |

**Decided: E.** AISO holds no credential on any client site. Options A–D stay
recorded but are not in this slice. AISO never publishes or edits a site itself;
the executor does the work, and AISO verifies the result from the public page.

**Q3 — What does "Google properties" mean here?** Google Business Profile
(posts/Q&A/attributes), Search Console actions (sitemap submit, URL inspection —
note the existing Search Console connector is `webmasters.readonly`), Tag Manager,
or something else? Each one is a separate scope, verification and consent
decision. **Default: out of this slice** until named.

**Q4 — First edit types.** The edit spec should start narrow. Candidates mapped
to existing AEO checks (`lib/checks/`):
- page `<title>` / meta description;
- one JSON-LD block (FAQPage / Organization / LocalBusiness) on one page;
- `llms.txt` content.

**Decided: JSON-LD on one page.** It is additive, the existing scan can verify it
afterwards (public fetch + check), and it is easy to revert.

**Q5 — Who may trigger an edit?** Options:
- any account member, as C9e allows for delivery reports;
- the C9d approver only;
- an approver who is not the submitter.

**Default:** the edit spec must be inside an **approved** version (C9d already
requires independent approval). Any member of the owning account may then *send*
it, mirroring C9e.

**Q6 — Plan and spend.** Is site-edit a plan feature (Pro/Enterprise) with a per-brand
cap, as the lock's «pre-packaged in the commercial plan» suggests? Is there vendor
cost (executor fees, platform API tiers)? **No spend without a named Approve.**

**Q7 — Flag. Decided: no new flag.** This is lower-risk under option E: AISO
never writes to a site, it sends a hand-off to an executor. The surface is gated
like the rest of the work-item/version flow: existing auth, account ownership,
commercial entitlement, and the C9d approval requirement. Nothing reaches an
executor until S2 exists, and that needs Q1 plus a named start.

## 3. Proposed shape (option E; executor details pending Q1)

1. **Structured edit spec in the review version (S1).** Extend C9c drafts and C9d versions with an optional
   `editSpec` field:
   - First kind: `{ kind: 'jsonld', targetUrl, schemaType, payload }`.
   - Validated server-side: the payload must be valid JSON-LD of an allowlisted type
     (FAQPage / Organization / LocalBusiness to start), the size is bounded, and
     `targetUrl` must be on the brand's verified domain (`clients.domain`).
   - Frozen into the version's content hash, so approval covers exactly this spec.
   - Existing prose-only versions stay valid. They are simply not "sendable".
   - The approved-package export (C9e) carries the spec as machine-readable JSON, so
     even before any executor integration a human delivering by hand gets exact markup.
2. **Hand-off (S2, needs Q1).** `POST …/work-items/[id]/versions/[versionId]/handoff` runs these checks:
   - auth → entitlement → ownership (account → client → item)
   - **approved latest version** whose hash matches the request
   - edit spec present
   - **exactly one** hand-off to the executor, with no retries
   - an insert-only ledger row: `sent | failed | unknown`, holding the executor's job reference

   Idempotency: **at most one open hand-off per version**. A second send returns the existing reference.

   The transport depends on Q1: an API call, a signed webhook, an email/ticket, or a
   queue the executor polls. AISO holds no client-site credential in any of them.
3. **Receipt (S3, needs Q1).** The executor reports completion with a **signed** receipt
   (job reference, URL, completion time). AISO verifies the signature, then treats the
   receipt as a *claim*, not proof.
4. **Check live → verified delivery (S4).** AISO fetches the target URL through
   `fetchPublicUrl` and checks that the frozen JSON-LD payload is present (and the
   relevant AEO check passes).
   - Only then does it record a C9e attestation with **verified** provenance (new
     provenance field; manual attestations stay labelled self-reported).
   - C9f then anchors on a verified time.
   - A receipt without the payload on the live page stays "reported, not verified".
5. **Revert:** after publish, revert is a new approved version whose edit spec removes the
   block, handed off the same way. There is no silent rollback.

## 3a. Hand-off and receipt contract (proposed defaults; Rick to confirm)

**Outbound: AISO → Rick (S2).** One `POST` to Rick's endpoint per approved
version, made only when a member clicks "Send to Rick".

- Body (JSON, canonical key order):
  - `jobId` (AISO's ledger id, a UUID)
  - `versionId`, `contentHash`
  - `client` `{ id, name, verifiedDomain }`
  - `editSpec` (the frozen S1 spec, unchanged)
  - `approvedAt`
  - `receiptUrl` (where to send the receipt)
- Headers:
  - `X-AISO-Timestamp` (unix seconds)
  - `X-AISO-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`
  - `X-AISO-Job-Id`
- Rules:
  - One attempt, 10 s deadline, no automatic retry.
  - A 2xx means Rick accepted the job (`sent`). A 4xx/5xx means `failed`. A timeout or transport error means `unknown`.
  - Rick must treat `jobId` as an idempotency key, so a manual re-send of the same job is a no-op on their side.

**Inbound: Rick → AISO (S3).** `POST /api/site-edit/receipts`, public, **authenticated only by signature**,
like `webhooks/neon` is by payload proof.

- Body:
  - `jobId`, `status` (`completed` | `rejected`)
  - `url`
  - `completedAt` (ISO time)
  - optional `note` (plain text, at most 2,000 characters)
- Headers: `X-Rick-Timestamp`, and `X-Rick-Signature: v1=<hex HMAC-SHA256(receiptSecret, timestamp + "." + rawBody)>`.
- AISO checks, in order:
  1. Constant-time signature check over the **raw** body.
  2. Timestamp within ±5 minutes.
  3. Body ≤ 8 KiB with strict keys.
  4. `jobId` exists and is `sent` or `unknown`.
  5. `url` equals the job's frozen `editSpec.targetUrl`.
  6. An identical replay returns the same 200 without a second write; a different body for a closed job is a 409.
- A receipt only records Rick's **claim**. "Verified" still needs S4's live-page check.

**Secrets (names only; values are ops' to set, Preview first):**
- `SITE_EDIT_EXECUTOR_URL`
- `SITE_EDIT_EXECUTOR_SECRET` (AISO signs outbound)
- `SITE_EDIT_RECEIPT_SECRET` (Rick signs receipts)

Two separate secrets, so a leak of one direction cannot forge the other.
Missing values mean the send button is disabled (未連接), with no request made.
Key rotation: accept `v1=` signatures from a `_PREVIOUS` secret during a rotation
window, as `GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS` does.

**Ledger (S2 migration, file-only):** `site_edit_jobs`, insert-only for `aeo_app`, with columns
`(id, account_id, client_id, version_id, content_hash, outcome, created_at)`.

`outcome` is one of `sent | failed | unknown`. Receipts go to a separate insert-only `site_edit_receipts` table,
so neither table is ever rewritten. Current state is the newest row, derived on
read, as `search_console_sync_runs` does it.

**Still to confirm with Rick:** endpoint URL per environment, whether they can
sign receipts with HMAC-SHA256 as above, their idempotency handling of `jobId`,
and the turnaround they commit to (shown to members as "sent", never "done",
until a receipt arrives).

## 4. Guardrails (non-negotiable for any option)

- **Owned and verified only.** The target host must match the brand's verified domain. There is no free-form URL from the
  operator at send time; the URL comes from the approved spec.
- **Approved input only.** The exact approved version hash, frozen edit spec, no LLM edits at send time, and no
  instructions read from page content.
- **AISO never touches the site.** Under option E, AISO holds no client-site credential and never
  publishes, deletes pages, installs plugins/themes or runs code there. The executor does the work.
- **One hand-off, no retries.** An unknown outcome says "may have been sent; check with the executor".
- **Never 2xx over a failed ledger write.** Never log credentials or connection strings.
- **Tenancy:** composite FKs `(client_id, account_id)` and an account filter on every query; no admin
  cross-account path.
- **Honesty:** no vendor names in operator UI unless they are the operator's own CMS (it is their account);
  no invented impact; "verified live" means only that the payload was found at fetch time.

## 5. Risks to weigh before Approve

| Risk | Why it matters | Mitigation in this shape |
| --- | --- | --- |
| Credential blast radius | A CMS credential can often edit the whole site | **Removed by option E**: AISO holds none |
| Wrong-site edit | Agencies manage many brands | Target URL frozen in the approved spec and checked against the brand's verified domain at validation and at send time |
| Content injection | Approved text originates from LLM-assisted drafts | JSON-LD payload schema-validated and escaped; human approval of the exact spec; human publish |
| Unknown hand-off outcome | A lost response may leave a job queued | Ledger `unknown`, no retry, executor job-reference lookup |
| Forged or wrong receipt | A receipt claims work that isn't live | Signed receipt **and** live-page verification before any "verified" status |
| Executor availability | A human/agency workflow has its own SLA | Hand-off state stays honest (`sent`, not `done`) until a receipt and live check |
| Legal/contractual | The executor edits a client's site on their behalf | Approved-spec audit trail and ledger; contract terms between Fimmick, the executor and clients 待確認 with Willy |

## 6. Slicing

- **S0 — Q1 discovery: done** (Rick = Fimmick dev agency, webhook, signed receipts). Contract in §3a, pending Rick's confirmation of the open items listed there.
- **S1 — edit spec in review versions (can start now, on a named start):** `editSpec` on drafts and
  versions, JSON-LD validation, domain check, hash, approval and export. No remote calls and no
  migration beyond the review-content schema version.
- **S2 — hand-off (needs Rick's confirmation of §3a + a named start):** single send, ledger (file-only migration), idempotency, UI states.
  - **Started 2026-11-04 (Willy: "start S2 site-edit").** Built to the §3a defaults *before* Rick
    has confirmed them; nothing can reach Rick until ops sets `SITE_EDIT_EXECUTOR_URL` and
    `SITE_EDIT_EXECUTOR_SECRET` (unset → the button reads 未連接 and no request is made), so a
    contract change from Rick is a config or code edit, never an unsafe live send.
  - **Ledger shape (differs from the §3a sketch):** migration `089` has `site_edit_jobs` (one per
    approved version, composite FK onto the exact `(version, content_hash)`) plus an insert-only
    `site_edit_job_events` log (`claim` → `sent | failed | unknown`) instead of an `outcome` column.
    The claim is written **before** the single call (unique `(job_id, seq)` serialises concurrent
    sends), so a process that dies mid-call leaves a claim that reads `unknown`, never `sent`. A
    manual re-send after `failed`/`unknown` is a new claim on the **same** `jobId`; nothing is sent
    after `sent`.
  - **No plan gate** (mirrors C9e; Q6 still open). **UI names no vendor**: "Send to developer" /
    「交由開發團隊」, per §4's honesty rule. `receiptUrl` points at `/api/site-edit/receipts`, which
    S3 creates.
- **S3 — signed receipts (same):** receipt endpoint, signature verification, ledger update.
  - **Started 2026-11-04 (Willy: "start S3 site-edit receipts").** Built to §3a as written:
    `POST /api/site-edit/receipts`, signature over the raw body first (no DB access before it),
    8 KiB cap, strict keys, `jobId` known, identical replay → 200 with no write, different body for a
    closed job → 409, `url` must equal the frozen `editSpec.targetUrl`. Migration `090` adds the
    insert-only `site_edit_receipts` (one per job). Two refinements: a receipt is accepted while the
    job's newest event is `claim` too, since the executor can answer before AISO records the
    outcome; and a job whose hand-off was `failed` (executor refused it) takes no receipt. The panel
    shows "the developer reports this was done on …, not yet checked on the live page". The secret
    is `SITE_EDIT_RECEIPT_SECRET` (+ `_PREVIOUS` for rotation); unset → 503 and nothing recorded.
- **S4 — check live → verified attestation:** public fetch + payload check, C9e provenance field, C9f anchor.
  - **Started 2026-11-04 (Willy: "start S4 site-edit live check").** A member presses "Check live page"
    (`POST …/versions/[versionId]/handoff/live-check`, gated like the hand-off). AISO makes one https GET of
    the frozen `editSpec.targetUrl` through the SSRF-pinned public fetcher (10 s, 2 MiB, ≤3 redirects) and
    looks for a JSON-LD node (block, array member or `@graph` member) equal to the approved payload after
    canonicalising both (sorted keys, NFC, `@context` ignored). Only an open job may be checked: handed off
    (`sent`/`unknown`) or reported completed, never refused or declined, and the version must still be the
    latest approved one on the verified domain. Checks are spaced a minute apart. Migration `091` adds the
    insert-only `site_edit_live_checks` (every check, whatever it found) and a C9e `provenance` column
    (`self_reported` default | `verified_live`) whose verified rows must name their job by composite FK.
    A find writes one verified attestation delivered at the check time, under the C9e locks, and only when
    no attestation is active; C9f anchors on it like any active attestation. The "relevant AEO check
    passes" clause is not in S4: "verified live" means the payload was found at fetch time, nothing more.
- **S5 — revert (§3 step 5).** **Started 2026-11-04 (Willy: "start S5 site-edit revert").** A revert is a new
  edit-spec kind, `jsonld_remove`, with the same fields and payload rules as an add. It is saved and submitted
  only when an earlier **approved** version of the same work item added exactly that block (target URL,
  schema type and payload, jsonb-equal), checked at draft save (`EDIT_SPEC_REVERT_UNMATCHED`, 409) and
  again at submit. It is then reviewed, approved, handed off and checked like an add — no silent rollback.
  Its live check verifies by **absence**: a page that loaded (2xx HTML) without the block. Migration `092`
  lets a verified attestation hang off a `missing` check; a `fetch_failed` check still can never carry
  one, so a page that did not load proves nothing. **Contract change for Rick (§3a):** the hand-off
  `editSpec.kind` can now be `jsonld_remove` — "remove the JSON-LD block equal to `payload` from
  `targetUrl`". Pending his confirmation, like the rest of §3a.
  Review fix: `086` pinned the stored spec kind to `jsonld` on drafts and versions, so migration `093` widens both
  CHECKs to `jsonld | jsonld_remove` (nothing else changes). The live-check matcher no longer stops at 50 JSON-LD
  blocks: a revert is verified by absence only after searching the whole (2 MiB-bounded) page.
- **S6 — automatic live check on receipt.** **Started 2026-11-04 (Willy: "start S6 site-edit", chose "auto
  live check on receipt").** When a signed `completed` receipt is newly recorded, the receipt route schedules one
  live check with Next `after`, so the executor's call is not held up by the page fetch. It runs as the member who
  made the job's newest claim (pressed "Send"), under exactly the gates a member's check passes — still a member,
  latest approved version, open job, verified domain, one-minute spacing — and its attestation note says it was
  checked automatically. Best-effort: a refusal or failure is logged by name only and the button stays for a
  person. A replayed, rejected or refused receipt schedules nothing. No migration; `receipts` gets a 30 s
  `maxDuration` for the fetch. A miss (page not yet updated) is recorded honestly and can be re-checked a minute later.
- **S7 — the AEO check clause (§3 step 4, deferred from S4).** **Started 2026-11-04 (Willy: "start S7
  site-edit", chose "AEO check clause").** Every live check whose page loaded also runs the scan's own
  structured-data check (`lib/checks/structuredData.ts`, c4) on the same fetched bytes — an injected fetcher
  answers with that page, so there is no second request — and stores its verdict (`pass | warn | fail` plus the
  check's message) on the check row (migration `094`). It is **recorded, not a gate**: "verified live" still means
  only that the approved payload was on the page. The panel shows the verdict under the live result.
- **S8 — plan gate (Q6).** **Started 2026-11-04 (Willy: "start S8 site-edit", chose "Plan gate (Q6)"; no tiers or cap
  named, so built to the brief's "pre-packaged in the commercial plan" and the Search Console precedent).** New
  `PlanFeatures.site_edit` (Free/Basic false, Pro/Enterprise true), resolved only through
  `resolveCommercialEntitlement`, which fails closed to free (override → past_due → cancelled → trial → paid). It gates
  **sending** a hand-off — the step that can carry executor cost: `403 HANDOFF_UPGRADE_REQUIRED` before any claim or
  outbound call, and the panel shows "Sending a site edit is part of the Pro and Enterprise plans." A job already sent
  keeps its receipt and live checks after a downgrade.
  - **Brand cap (2026-11-05, Willy: "10 / month").** At most `SITE_EDIT_MONTHLY_SENDS_PER_BRAND` = 10 sends per brand
    per calendar month, Hong Kong time, on every entitled plan. A send is a job (one per approved version; a revert
    counts) with a `sent` or `unknown` outcome, or a claim with no outcome yet (however old), this month; a refused (`failed`) hand-off
    does not count, and re-sending a job already counted adds nothing. Enforced inside the claim statement under a
    per-brand advisory lock (so two versions cannot both take the tenth slot); the panel shows "This brand has used
    its 10 site edits for this month." and the route answers `429 HANDOFF_LIMIT_REACHED` before any claim or call.
    No migration.

Each slice: a draft PR, `vercel.json` +1 for its branch, migrations file-only, and a Ready packet for Willy.

## 7. Out of scope

- Publishing, deleting, theme/plugin installs, arbitrary HTML/JS, edits outside the brand's verified domain.
- Free-form "change this page" chat commands.
- Google properties until Q3 names one.
- Scraping or SERP (data path, 6e/6f).
- Pricing and plan SKUs. (`PlanFeatures.site_edit` and the 10/month brand cap exist since S8.)

## 8. HOLD / NO_GO

- Prod/Preview LIVE, `STUDIO_LIVE_ANSWERS_PER_WEEK`, any `FEATURE_*` (Q7 decided: no new flag), any Vercel env, GCP or CMS console changes.
- Hosted Neon migrate of 054 / 081 / 082 / 083 / 084 / 085 / any new migration.
- Live writes to any real website from tests or CI.
- Merge, undraft, force-push shared branches.
