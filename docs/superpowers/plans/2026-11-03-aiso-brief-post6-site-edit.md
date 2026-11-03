# AISO brief — post–Stage 6: site-edit (act/edit on the brand's own website)

> **Scoping brief.** Willy decided on 2026-11-03: **option E (executor hand-off)**,
> **JSON-LD first**, **no new flag**. One blocker remains: **Q1, the executor's
> interface** (what Rick work pass／Rap FED are, how a job reaches them, and what
> receipt comes back). S1 (the edit spec inside review versions, §6) makes no
> remote call and can start on a named start. Nothing that talks to an executor is
> built before Q1 is answered and a named Approve covers any spend. Draft PRs only.
> Never merge.

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

**Q1 — What are "Rick work pass" and "Rap FED"?** They appear only in the lock's
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

- **S0 — Q1 discovery (no code):** what Rick work pass／Rap FED are, how a job reaches them,
  and the receipt they can sign. Output: an amended brief with the transport and receipt contract.
- **S1 — edit spec in review versions (can start now, on a named start):** `editSpec` on drafts and
  versions, JSON-LD validation, domain check, hash, approval and export. No remote calls and no
  migration beyond the review-content schema version.
- **S2 — hand-off (needs S0):** single send, ledger (file-only migration), idempotency, UI states.
- **S3 — signed receipts (needs S0):** receipt endpoint, signature verification, ledger update.
- **S4 — check live → verified attestation:** public fetch + payload check, C9e provenance field, C9f anchor.

Each slice: a draft PR, `vercel.json` +1 for its branch, migrations file-only, and a Ready packet for Willy.

## 7. Out of scope

- Publishing, deleting, theme/plugin installs, arbitrary HTML/JS, edits outside the brand's verified domain.
- Free-form "change this page" chat commands.
- Google properties until Q3 names one.
- Scraping or SERP (data path, 6e/6f).
- Pricing, plan SKUs, `PlanFeatures` keys (until Q6).

## 8. HOLD / NO_GO

- Prod/Preview LIVE, `STUDIO_LIVE_ANSWERS_PER_WEEK`, any `FEATURE_*` (Q7 decided: no new flag), any Vercel env, GCP or CMS console changes.
- Hosted Neon migrate of 054 / 081 / 082 / 083 / 084 / 085 / any new migration.
- Live writes to any real website from tests or CI.
- Merge, undraft, force-push shared branches.
