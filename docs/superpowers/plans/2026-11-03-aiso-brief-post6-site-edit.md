# AISO brief — post–Stage 6: site-edit (act/edit on the brand's own website)

> **This is a scoping brief, not a build brief.** The locked design names site-edit
> only as a later, Approve-gated backlog item, and the products it names (Rick work
> pass／Rap FED) are not in the repo or this brief's sources. §2 lists the blocking
> decisions. **No code, branch or spend until Willy answers them and names a start**
> (the design requires a named Approve before spend/scope). Draft PRs only. Never merge.

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

## 2. Blocking decisions（Willy; don't invent）

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

**Recommendation (pending Q1):**
- If Rick/Rap FED is an executor, go with **E first**.
- Otherwise, go with **B or A, drafts/PRs only**, whichever platform most current clients run.
- In every option a human publishes in their own system. **AISO never publishes.**

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

**Default: JSON-LD on one page.** It is additive, it is verifiable afterwards by
the existing scan (public fetch + check), and it is easy to revert.

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

**Q7 — Flag.** Remote writes to a client's website are a new risk class.
Unlike Drive, an unknown outcome here touches a public site. Confirm whether this
slice may ship behind a **new** `FEATURE_SITE_EDIT` flag (default off, Preview
first). That would be a deliberate exception to "no new flags", and it needs a
named Approve.

## 3. Proposed shape (defaults; changes with Q1/Q2)

1. **Structured edit spec in the review version.** Extend C9c drafts and C9d versions with an optional
   `editSpec` field:
   - It contains `{ kind: 'jsonld', targetUrl, schemaType, payload }` for the first kind.
   - It is validated server-side: the payload must be valid JSON-LD of an allowlisted type, the
     size is bounded, and `targetUrl` must be on the brand's verified domain.
   - It is frozen into the version's content hash, and approval covers exactly this spec.
   - Existing prose-only versions stay valid. They are simply not "sendable to site".
2. **Connection per brand** (not per profile: the site belongs to the brand):
   - A sealed credential, vault AAD `site:<clientId>`.
   - It binds only if the connected site covers the brand's domain (reuse the binding check).
   - Least scope, plus revoke/disconnect like Drive.
3. **Send:** `POST …/work-items/[id]/versions/[versionId]/site-edit` runs these checks:
   - feature gate → entitlement
   - ownership (account → client → item)
   - **approved latest version** whose hash matches the request
   - edit spec present
   - live connection bound to the domain
   - **exactly one** provider write that creates a draft/PR, with no retries
   - an insert-only ledger row: `requested | created | failed | unknown`, holding the provider
     reference (draft id / PR URL)

   Idempotency: **at most one live draft per version**. A second send returns the existing reference.
4. **Delivery:** when the member publishes in their own system, AISO does not take their word for
   it. A "Check live" action:
   - fetches the target URL through `fetchPublicUrl`;
   - runs the relevant AEO check;
   - if the frozen payload is present, records a C9e attestation with **verified** provenance
     (new provenance field; manual attestations stay labelled self-reported).

   C9f then anchors on a verified time.
5. **Revert:** for A/C, a draft that was never published can be discarded via the provider. After
   publish, revert is a new approved version (an edit spec that removes the block). There is no
   silent rollback.

## 4. Guardrails (non-negotiable for any option)

- **Owned and verified only.** The target host must match the brand's verified domain. There is no free-form URL from the
  operator at send time; the URL comes from the approved spec.
- **Approved input only.** The exact approved version hash, frozen edit spec, no LLM edits at send time, and no
  instructions read from page content.
- **Drafts/PRs, never publish.** AISO never deletes pages, installs plugins/themes or runs code on the
  client's site.
- **One write, no retries.** An unknown outcome says "may have been created; check your CMS".
- **Never 2xx over a failed ledger write.** Never log credentials or connection strings.
- **Tenancy:** composite FKs `(client_id, account_id)` and an account filter on every query; no admin
  cross-account path.
- **Honesty:** no vendor names in operator UI unless they are the operator's own CMS (it is their account);
  no invented impact; "verified live" means only that the payload was found at fetch time.

## 5. Risks to weigh before Approve

| Risk | Why it matters | Mitigation in this shape |
| --- | --- | --- |
| Credential blast radius | A CMS credential can often edit the whole site | Drafts-only scopes where possible; per-brand seal; option D or E avoids holding one |
| Wrong-site edit | Agencies manage many brands | Domain binding at connect time and at send time; target URL frozen in the approved spec |
| Content injection | Approved text originates from LLM-assisted drafts | JSON-LD payload schema-validated and escaped; human approval of the exact spec; human publish |
| Unknown outcomes on a public site | A lost response may leave a draft | Ledger `unknown`, no retry, provider reference lookup |
| Platform variance | Each CMS differs | One platform per slice; adapters behind one interface |
| Legal/contractual | Editing a client's site on their behalf | Operator-owned connection, explicit consent screen, audit ledger; contract terms 待確認 with Willy |

## 6. Slicing (after decisions)

- **S0 — discovery (no code):** answer Q1–Q3. If option E, get Rick/Rap FED's interface and receipt format. Output: an amended brief.
- **S1 — edit spec in review versions:** `editSpec` on drafts/versions, validation, hash, approval UI. No remote calls. Useful on its own: exports carry a machine-readable spec for manual delivery.
- **S2 — connection:** connect/disconnect, domain binding, sealed credential, migration (file-only).
- **S3 — send as draft/PR:** single write, ledger, idempotency, UI states.
- **S4 — check live → verified attestation:** public fetch + check, C9e provenance field, C9f anchor.

Each slice: a draft PR, `vercel.json` +1 for its branch, migrations file-only, and a Ready packet for Willy.

## 7. Out of scope

- Publishing, deleting, theme/plugin installs, arbitrary HTML/JS, edits outside the brand's verified domain.
- Free-form "change this page" chat commands.
- Google properties until Q3 names one.
- Scraping or SERP (data path, 6e/6f).
- Pricing, plan SKUs, `PlanFeatures` keys (until Q6).

## 8. HOLD / NO_GO

- Prod/Preview LIVE, `STUDIO_LIVE_ANSWERS_PER_WEEK`, any `FEATURE_*` (Q7 needs its own named Approve), any Vercel env, GCP or CMS console changes.
- Hosted Neon migrate of 054 / 081 / 082 / 083 / 084 / 085 / any new migration.
- Live writes to any real website from tests or CI.
- Merge, undraft, force-push shared branches.
