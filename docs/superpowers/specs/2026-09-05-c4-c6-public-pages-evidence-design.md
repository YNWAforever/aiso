# C4–C6 public pages and scan evidence design

Status: approved by the user on 2026-09-05; implementation authorized locally.

## Basis and boundaries

The user requested local development of C4–C6 from the continuation plan. Base is `c123ac254d44a179b7d2f19a19d400ff1cd657b3`, containing C2/C3 and the separate pricing contrast repair. PR #14 is open against main; this design does not authorize adding new slices to that PR, pushing, merging, deploying, changing environments, running migrations, creating provider resources or sending real scans/email.

Keep the user's untracked continuation plan intact. Implement on a new local `codex/c4-c6-public-pages-evidence` branch based on the verified C2/C3 head. Maintain a reviewable patch per family; eventual publication should use separate family PRs, with no implicit publication approval. Do not repeat tokens, shell, pricing, snapshots or Phase 0 work.

Current source establishes only home/pricing NAV availability, catalog-backed metadata and sitemap, a client header with desktop grouped disclosures, and an origin-normalized scan writer with persisted pillar snapshots. The graph is a discovery aid, not proof of route completeness. Installed Next.js 16.2.4 server/client and layout guides were consulted for the proposed boundary.

## Approach selection

1. Recommended: explicit Server Component routes, small reusable presentation components, catalog-driven copy and the existing metadata helper; additive evidence JSON in the current scan record. This keeps route review and compatibility straightforward.
2. A generic catch-all page renderer would shorten scaffolding but obscure route availability and family-specific claims. Do not use it.
3. A donor monolith or a new evidence schema/crawler would enlarge the runtime and operational scope. Do not use either for these slices.

## C4: first family and navigation

Create `/platform` and `/platform/site-health` under the marketing route group for both locales. Use existing tokens, cards and typography. Review donor layout/copy at its pinned commit during implementation; transplant presentation only, never fixture metrics or unsupported claims.

Each capability page has one H1, a plain-language summary, supported actions, evidence/limitations, and an existing destination CTA. The primary CTA remains `/{locale}#scan`; authenticated capabilities link to the existing localized login journey. No `/scan`, `/sample-report`, `/methodology` or discovery journey is implied.

Use a non-modal mobile disclosure below desktop width. A labeled button exposes `aria-expanded` and `aria-controls`; opening leaves focus on the trigger and Tab enters available links. Escape closes and returns focus to the trigger; selection/path change closes it. No modal focus trap. Mobile groups are ordinary labeled link lists. Preserve desktop native grouped details, add tested Escape/close behavior, and mark exact current links with `aria-current=page`. Locale links retain the route path. Header layout must fit 375px and enlarged text with 44px controls.

Enable NAV entries only with their real route, localized metadata and tests. Exact sitemap count grows from 4 to 8 localized URLs after C4.

## C5: page families and claims

| Family | Routes added | Content and release boundary | Total sitemap URLs |
|---|---|---|---:|
| C5a | platform/search-intelligence, demand-intelligence, brand-product-discovery | Search readiness is not live search ranking data; demand uses the existing question-bank capabilities; discovery has no live entity backend and is labeled Planned | 14 |
| C5b | platform/ai-visibility, action-studio, governed-agents, proof | Explain sampled Pulse results, editable Fix outputs and report evidence limits; governed agents are Planned; no autonomous publication or proven uplift claim | 22 |
| C5c | solutions and solutions/sme, agencies, enterprise, regulated-industries | Reuse audience presentation; describe workflows without promising enterprise roles, certification or regulated-industry compliance | 32 |
| C5d | how-it-works, resources, contact | Explain the existing scan/review workflow; resources link to implemented pages; contact is an honest handoff page with no invented address, form delivery or response SLA | 38 |
| C5e | security, trust, integrations | Describe verified source controls and known limits; provider usage is not a user-connected integration; no runtime connection status or compliance badge without evidence | 44 |
| C5f | privacy and terms drafts in documentation only | Prepare bilingual drafts for legal review; do not enable routes, NAV or sitemap entries without approved legal text and operator details | 44 |
| C5g | supported public aliases | Add only aliases whose destinations are implemented; do not change report access or workspace navigation | 44 |

Use present source/product facts for numeric claims: 20 checks and a 100-point headline; diagnostic pillars overlap. Platform vocabulary is not proof of live measurement or coverage. Planned pages can explain a future capability but cannot offer a fake working action. Technical/product review of the actual bilingual copy is part of the local handoff, before any publication decision.

For C5g, implement frozen public aliases to search intelligence, site health, demand intelligence and AI visibility using permanent 308 redirects, preserving locale. Keep existing bare pricing/login redirects. Do not create sample-report redirects before C8, rewrite workspace integration routes, or change revoked/expired report behavior: current report 404 behavior remains; a 410 decision belongs with report access work. The exact alias table must be tested against the frozen manifest before implementation.

## C6: proposed evidence v1 contract

Add `results.evidence` alongside existing check outputs and `pillarScores`. No SQL migration, historical backfill, raw HTML archive or additional provider/network request. Existing checks, headlines, quota/retry behavior and pillar weights remain unchanged.

- Envelope has `schemaVersion`, scanner/check/methodology versions, requested and completed scope, sanitized URL descriptors, collection metadata, check records, limitations, and comparison signature. Do not use a top-level `status` property: an existing result reader treats objects with that property as checks.
- Scope is `single-origin-page` because the current writer normalizes input to origin. Distinguish requested input from evaluated target; expose normalization and redaction rather than implying path scanning.
- Collection state is separate from assessment: complete, partial, blocked, failed, unsupported or unknown. Pass/warn/fail is not evidence of successful collection. Not-applicable and not-verifiable remain explicit; historical envelopes are unknown, never fabricated.
- Capture safe fetch metadata inside the injected SSRF-safe fetch boundary, retaining DNS pinning and redirect-hop validation. The current constructed Response discards final URL; capture the validated final target directly, never assume `Response.url` is populated. Request-local capture must not leak between concurrent scans.
- Successful settled promises do not establish collection success. Check-internal fallbacks, including provider failures, need optional diagnostics; rejected checks retain their existing benchmark result but record failed collection. No score or retry change is bundled with this instrumentation.
- Evidence v1 retains allowlisted parsed booleans, counts and enumerations only. Free-text page/provider excerpts have a **zero-byte budget**. Exclude raw request bodies, userinfo, query strings, fragments, cookies, authorization, arbitrary headers, provider output and raw error messages.
- Proposed cap: **32 KiB serialized UTF-8 per envelope, 1 KiB per check record**, at most the existing 20 check keys. Apply deterministic truncation with explicit omitted/limited flags; preserve collection state and version identity. No serialized cap may turn a storage failure into success.
- URL descriptors retain origin plus explicit path/query/fragment-redaction and origin-normalization flags; avoid storing arbitrary path segments or hashes of secret-bearing input. Final redirect descriptors record the validated destination origin and that path detail was withheld. This deliberately favors privacy over exact path reconstruction.
- Persist scanner version and a registry of all 20 check versions; preserve the pillar methodology version and identify the unchanged headline method. Comparison signature covers scope, evaluated/final origin identity, industry/region, sitemap input provenance, versioned URL-redaction policy, scanner/check set and both scoring methods. Exclude timestamps and verdicts. Equal signatures only establish compatible methods: incomplete collection or withheld final-path identity must separately prohibit comparable-improvement claims. Mismatch or unknown history is never comparable.
- Retention inherits the existing scan record lifecycle. Do not promise a deletion TTL or introduce cleanup jobs. No new public exposure: existing summary projections must omit the envelope, while authorized readers remain tolerant of missing or malformed historic envelopes.
- Preserve blocked-request behavior: SSRF-rejected input returns the existing 400 without inserting a scan. Pure normalization tests cover blocked states without promising persisted rejection attempts. Allow only parsed MIME type, numeric content length, valid last-modified time and parsed robots directives as header evidence; cap observations at 40 and each parsed signal at 512 UTF-8 bytes within the aggregate cap. Keep all 20 check state/version records when dropping optional observations. Exclude evidence from existing outbound webhook payloads.
- Explicitly amend the frozen fields/versioning contracts to select bounded JSON instead of proposed new tables, correct already-persisted pillar status, and register the current unchanged headline formula identifier. This is not a score-method change.
- Preserve existing ownership response semantics and guards. The id-only ownership lookup is not silently bundled into the envelope change; tests must prove the existing wrong-owner denial and no evidence leakage.

C6 is three reviewable implementation steps: pure contract/normalization and tests; request-local collection diagnostics plus additive writer/read-back tests; scanner-versioned robots wildcard/precedence and bot-role catalogue fixtures. The third step must consult current official bot documentation and bump scanner/check versions for behavior changes, while retaining headline weights and grade semantics.

## Verification and handoff

For every page family: exact NAV/files/metadata/sitemap coverage; both locales; real CTA destinations; release-state assertions; browser navigation, locale preservation, keyboard/Escape and active states at 375/768/1024/1440 in both themes. Run existing auth/onboarding and accessibility regressions. Do not raise accepted accessibility counts.

Record production-build transferred JS/CSS and Lighthouse measurements using the same fixture/server settings before and after each family. Use measured baseline as the budget; flag >10% JS/CSS growth or material LCP/CLS regression. Missing Lighthouse setup is a reported evidence blocker, not a fabricated result. Avoid paid scans and real providers throughout.

C6 fixtures cover successful fetch, redirect, timeout, blocked URL/hop, provider fallback, rejected/missing check, genuine assessment fail, not-applicable, old/malformed envelope, UTF-8 caps, secret-bearing URLs/headers, concurrent capture isolation, writer failure and wrong-owner access. Prove new envelope and existing pillar snapshot are stored together and read compatibly. Preserve score outputs for unchanged fixtures.

Run full unit suite, source lint, typecheck and default production build on the final source; independent review per slice and a final combined review. Report precise local checks, setup blockers and remaining external proof separately. No database or provider tests are authorized by this design.

Rollback public pages with their NAV entries and metadata; reverse each family independently. Disable new evidence consumers first and retain additive historical JSON. Revert instrumentation without rewriting scores or backfilling records. Keep robots behavior repair separate so its version can be traced.

## Approval requested

Approve this implementation design, including the C6 parsed-signal-only policy, 32 KiB/1 KiB budgets, origin-only URL descriptors and inherited scan retention. Legal drafts remain unpublished and all external actions remain separately gated. These are new evidence-retention decisions; the repository, framework, locales, scoring and existing C2/C3 choices are already settled.
