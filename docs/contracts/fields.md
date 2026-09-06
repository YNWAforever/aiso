# Field contract

Frozen from base plan §10.2, 2026-08-31. Changes require a plan amendment, not a silent edit
here.

Approved amendment: [C4–C6 evidence design](../superpowers/specs/2026-09-05-c4-c6-public-pages-evidence-design.md), 2026-09-05. The evidence rows below use additive bounded JSON instead of proposed new tables.

## UI field provenance matrix

Provenance classes follow the donor's vocabulary: `deterministic check` · `provider-documented` · `first-party evidence` · `sampled observation` · `heuristic` · `inference` · `estimate` · `synthetic fixture`. Repeated fields are grouped where one component and one DTO contract cover them.

| UI field / action | Donor source | Existing live DTO / query | Existing table / JSON field | Roadmap target | Provenance class | Real/derived/new/blocked | Required validation | Phase |
|---|---|---|---|---|---|---|---|---|
| Headline score 0–100 | `calculateRepoScanResult().score` | `calculateScore + calculateGeoScore` | `scans.score` | — | deterministic check | **real** | equals stored value; cap at 100 | 3 |
| Grade A+…F | `grade()` | `assignGrade` | `scans.grade` | — | deterministic check | **real** | thresholds unchanged | 3 |
| Check status ×20 | `REPO_SCAN_CHECKS[].state` | `ScanResults[cN]` | `scans.results` JSONB | — | deterministic check | **real** | key present; no `check_error` literal | 3 |
| Check message | fixture bilingual | `CheckResult.message` | `scans.results` | — | deterministic check | **real** | domain-specific, not `check_error` | 3 |
| Check name / why / action copy | fixture tuples | `lib/checkExplanations.ts` | — | — | static copy | **real** (move to `messages/*`) | i18n parity | 2 |
| Owner lens grouping | `RepoScanCheck.lens` | — | — | — | static mapping | **new** (derived) | 20/20 mapped | 3 |
| Parsed evidence signals | `RepoScanCheck.evidence` | `buildScanEvidence` | `results.evidence.observations` | no new table | sampled observation | **real, bounded JSON** | zero free-text bytes; only parsed booleans/counts/enums and allowlisted header signals | C6 |
| Evaluated URL descriptor | fixture | origin-normalized `baseUrl` | `results.evidence.evaluated` | no new table | deterministic check | **real** | origin only plus explicit redaction/normalization flags | C6 |
| Final redirected URL descriptor | — | SSRF-safe fetch boundary | `results.evidence.final` | no new table | sampled observation | **real** | validated final origin, path withheld; never infer from constructed Response.url | C6 |
| Fetched-at timestamp | — | request-local observer | `results.evidence.observations[].observedAt` | no new table | sampled observation | **real** | collection event time, separate from envelope and row timestamps | C6 |
| HTTP status + safe headers | — | request-local observer | `results.evidence.observations` | no new table | sampled observation | **real** | parsed MIME, numeric length, valid last-modified time, parsed robots flags; no arbitrary headers | C6 |
| Check / scanner / methodology versions | `methodVersion: "1.2-demo"` | version registries | `results.evidence` and `results.pillarScores` | no new table | deterministic check | **real** | all 20 check identities retained, unchanged headline method recorded | C6 |
| Pillar score ×3 | `calculatePillarScore` | `calculatePillarScores` | `results.pillarScores` | — | deterministic check | **real, already persisted** | immutable snapshot written and read back | 0/C6 |
| Evidence coverage % | `coveragePercent` | — | — | derived | deterministic check | **new** | falls when data missing | 3 |
| Score gate status | `insufficient_evidence`/`provisional`/`scored` | `calculatePillarScores` | `results.pillarScores.{seo,aeo,geo}.state` | no new table | deterministic check | **real, C7 v2** | unrounded weighted 0.67 / 0.85 gates; insufficient `score` is null; old snapshots unchanged | C7 |
| Comparison signature | fixture | `buildScanEvidence` | `results.evidence.comparisonSignature` | no new table | deterministic check | **real, no improvement claim** | method/scope equality is necessary but incomplete/redacted evidence is never comparable | C6 |
| Impact / expected uplift | fixture | `lib/impact.ts` | derived | — | estimate | **real, label Estimated** | never stated as guarantee | 3 |
| Observed impact | fixture outcome ledger | — | — | outcome windows | sampled observation | **new** | requires recorded delivery | 5 |
| Entity name / aliases / identifiers | `fixtures.entities` | `clients.brand_name` (partial) | `clients` | brands/products | first-party evidence | **new** | ownership verification | 5 |
| Entity ownership verified badge | fixture | — | — | verification | first-party evidence | **blocked** — needs policy | policy first | 5+ |
| Observation surface / match / role | `fixtures.observations` | `pulse_metrics` (partial) | `pulse_metrics` | `ai_observations` | sampled observation | **new** | valid denominator; failure ≠ absence | 5 |
| Share of voice | — | `pulse_weekly_summary.sov_score` | live | — | sampled observation | **real rollup; availability validated in C8a** | no successful denominator or latest aggregate means unavailable, not zero | C8a |
| Opportunity value/confidence/reach/effort/risk | `fixtures.opportunities` | `agent_recommendations` (partial) | `agent_recommendations` | opportunities | inference | **new** | evidence link required | 5 |
| Change-set diff + validations | fixture | `fix_packs` | `fix_packs` | change sets | deterministic check | **new** | immutable versions | 5 |
| Approval state + approver + timestamp | `demo-lifecycle` | — | — | approvals | first-party evidence | **new** | real approver identity | 5 |
| Delivery attestation | fixture | — | — | delivery | first-party evidence | **new** | record actual delivery | 5 |
| Plan name + price | HKD proposal | `PLAN_CATALOG` | — | — | runtime product truth | **real — donor value is a proposal** | rendered from catalog | 2 |
| Plan release state | `Demo`/`Planned` | `PlanReleaseState` | — | — | runtime product truth | **real** | never gate on release state | 2 |
| Entitlement / quota remaining | fixture | `resolveCommercialEntitlement` | `accounts` | — | runtime product truth | **real** | fails closed to `free` | 4 |
| Asia market coverage | `ASIA_DEMO_COVERAGE_MATRIX` | — | — | — | **synthetic fixture** | **blocked from production** | must not claim live coverage | — |
| Integration connection status | fixture | — | — | connections | first-party evidence | **new** | release state honest | 6 |
| Role matrix (7 roles) | fixture | `profiles.is_admin` only | `profiles` | roles | — | **blocked** — needs decision | decision first | 5+ |
| Demo-data banner | `ReviewBanner` | — | — | — | review-only | **must not ship** | absent from prod bundle | 2 |

**Static marketing claims, CTAs, and release labels are inventoried separately** and must never be rendered through a data-bound component: comparison/experience/audience sections, `FinalCta`, `PricingPreview`, `IntegrationPreview`, all `publicPages` capability copy, and both legal summaries. Each is copy requiring sign-off (legal for privacy/terms; product for capability claims), not a live field.

## Evidence storage limits and exposure

Evidence v1 is at most 32 KiB serialized UTF-8, with all 20 check records at most 1 KiB each, at most 40 observations and 512 bytes per parsed signal. Optional observations are dropped deterministically and `limited` is explicit. Collection and applicability are independent of pass/warn/fail; provider fallback is not successful collection. `completedPages` and `completedScope` reflect whether a page was actually collected. No top-level `status` is present, preserving existing check-reader compatibility.

The envelope is stored with the existing pillar snapshot in one insert. Insert failure remains non-success. Existing anonymous summaries and outbound webhooks omit evidence. Wrong-owner denial and SSRF-blocked 400 responses remain unchanged, and blocked requests insert no row. Authorized consumers may call the tolerant fail-closed reader; no new consumer or public exposure is introduced.

C7 writes validated evidence before calculating the pillar snapshot in the same existing insert. `coverage` is unrounded complete observed weight / applicable weight; `maximum` excludes explicit not-applicable weight, while `checks` retains the fixed mapped-check count and `covered` counts complete observed checks. `score: null` suppresses diagnostics below coverage 0.67 or with zero applicable weight. Historical numeric snapshots retain their original values and method without a synthetic state. Server-to-client scoring inputs include only applicability, collection and assessment, and only within owned detail access.


## C8a owned workspace home and overview (2026-09-06)

Both the default owned-client home and `GET /api/clients/[clientId]/overview` call the server-only `loadOwnedWorkspace`. The caller authenticates independently; the loader first binds `clients.id = clientId AND account_id = profile.account_id`. Missing ownership returns null/404, while a failed lookup throws. All subsequent reads carry client/account predicates directly or through an owned-client/scan join. No write, provider call, Local Trust snapshot creation or schema change is part of this loader.

| Home field | Persisted query / compatibility field | Availability and interpretation |
|---|---|---|
| `client` | `clients.id, brand_name, domain, industry, status` | Owned identity only; no verified-entity claim. Overview retains `client.brand_name`. |
| `siteHealth` | Latest owned `scans` by `created_at DESC, id DESC`, or exact explicitly supplied `scanId` | Invalid explicit ID stays empty without fallback. Score/time normalized from driver number/string/Date values. `pillarScores` is only a valid stored snapshot; absent/invalid is null, never an invented recalculation. No comparable improvement claim. |
| `history` | Latest ten owned `scans.id,domain,score,grade,created_at` | Chronological observation dates and persisted headline values; no inferred improvement. Overview retains `scanHistory`. |
| `visibility` | Newest 40 distinct weeks across owned `pulse_weekly_summary` and `pulse_metrics`; all summary rows for those weeks returned chronologically | Latest week is selected before aggregate lookup, so no old aggregate fallback. API keeps `pulseSummary` and nullable `pulseKpi`; successful denominator validation applies to KPI. |
| `visibility.data` | Persisted aggregate `sov_score,brand_mentions,total_queries,scan_week` plus observed platform count | `sovScore` is a percentage. KPI requires positive rollup total matching both raw row count and rows with non-whitespace `raw_answer` (`~ '[^[:space:]]'`) and nonnull `brand_mentioned`, with observed true-mention count matching the rollup numerator; numeric missing/invalid values are unavailable. `platformCount` counts distinct platforms with such answers. This proves stored answer observations, not current provider availability or causation. |
| `recommendations` | `agent_recommendations` joined to selected owned scan, ordered by priority/impact | `agent_recs` controls whether a query occurs; `platform_access` filters both SQL and returned rows using existing recommendation keys. The home labels these generated drafts (`generated:true`), never delivered/published work. |
| API `progress` / `competitors` | Selected owned scan joins to corresponding agent tables | `agent_progress` / `agent_competitors` control queries and returned arrays. Preserve existing platform vocabularies: no new per-platform restriction for these two existing feature gates. |
| API `missedOpportunities` | Latest ten owned metrics with brand_mentioned=false and nonblank raw answer | Empty retrieval is not a measured visibility percentage. Raw answers are used only in SQL predicates, never added to the DTO. |

`resolveCommercialEntitlement` is the sole authority for paid permissions, including Basic, Pro, Enterprise, live/expired trials, cancelled/past-due accounts and admin overrides. Denied arrays are empty in the compatible overview DTO and forbidden queries never run. Pulse read access remains authenticated ownership access, not a new paid gate.

The pure `buildWorkspaceHome` projection emits section `state: ready | empty | error | locked`, `data` (null unless ready), `observedAt` (nullable), and `freshness: unknown`. No stale threshold is approved. Optional home read errors remain panel errors; the overview API rejects any failed read with its established 500 response rather than returning partial success. Anonymous API callers remain 401; ownership miss remains 404. Legacy explicit dashboard step routes retain their existing behavior outside this new home adapter.


## C8b owned portfolio (2026-09-06)

`loadOwnedPortfolio({profile})` runs only after the page authenticates. Its authoritative active-client lookup binds `account_id` and `status='active'`; failure throws rather than manufacturing an empty portfolio. It then batches three independent optional reads (two when no active clients): all-owned-client count, latest ten owned scans and latest Pulse observations for active owned clients. Query count is independent of client count; the portfolio never invokes the full workspace loader per client or reads agents.

| Portfolio field | Exact source / query boundary | Semantics |
|---|---|---|
| `clients[]` identity | `clients.id,brand_name,domain,industry,status`, account-bound active rows, deterministic created_at/id ordering | Only these narrow fields reach the UI; clientId and existing owned-home links remain stable. |
| `clients[].visibility` | Batched `owned_clients` CTE binds account_id, active status and initially selected ids; summary/raw weeks are unioned then `max(scan_week)` grouped per client | No global latest-week selection, old aggregate fallback or cross-client count fanout. Aggregate observations group by client AND selected week before joining a persisted summary. |
| Visibility state/data/date | Shared pure `projectObservedSummary` from `lib/pulse/observed-summary.ts`, extracted unchanged from C8a | Exact C8a usable-answer denominator/numerator checks; genuine zero remains zero, raw-only newest weeks/missing or mismatching evidence are unavailable. `observedAt` is selected week; `freshness` remains unknown. The DTO excludes raw answers and internal count-validation fields. |
| `history` | `scans.id,domain,score,grade,created_at` bound by account_id, `created_at DESC,id DESC LIMIT 10` | Persisted values only; number/string scores and Date/string timestamps normalize at the boundary. Missing date stays unknown. Keep guarded `/result/{id}` links, no deltas/ranking/comparability claim. |
| `capacity.count` | `count(*)::int FROM clients WHERE account_id = profile.account_id` with NO active predicate | Includes inactive clients exactly as the existing creation API does; missing/error/invalid count is unknown, never zero. |
| `capacity.limit,plan,canCreate` | `resolveCommercialEntitlement(profile.accounts).features.max_brands` and effective plan | Known count below limit yields true; reached limit false; unknown count yields null. API and database trigger remain independent final authorities, including concurrent creation races. |

The pure `buildPortfolio` returns only clients, history and capacity. Optional history/Pulse failures are section errors, while unavailable count is `capacity.state='unknown'`; none converts an incident into measured zero or promised capacity. No provider attempt-success rate is asserted. Existing C8a DTO shape and historical diagnostic handling remain unchanged by the extracted pure Pulse helper. No database, provider or Local Trust write, migration or creation-API behavior change belongs to C8b.

## C8c–g existing workspace adaptations (2026-09-06)

These adapters preserve authenticated ownership and existing mutation contracts. They do not introduce provider calls, roles, delivery approval, migrations or a new entitlement resolver.

| Slice / displayed field | Source and boundary | Interpretation |
|---|---|---|
| C8c Pulse identity | `loadOwnedPulse` validates the UUID before `db()`, then binds client id and account id; missing ownership returns null | Page authenticates separately; malformed/missing/foreign client is 404, lookup outage is a generic load error. |
| C8c observations and chart | At most 40 distinct stored weeks from owned summary/raw observations; per-week/platform counts use the shared observed-summary validator | Chart spans at most 40 calendar weeks ending at the latest observed week. Missing or invalid points are null gaps; genuine zero survives. No interpolation, old KPI fallback, current-provider or causation claim. Freshness remains unknown. |
| C8c prompts / missed opportunities | Three bounded independent owned reads; prompts expose the existing narrow editable fields, missed rows require a nonblank answer and false brand mention | No raw answers in the DTO. Independent ready/empty/error states. Prompt mutation endpoints, categories, quota and feature guards remain authoritative; failed network mutations roll back or preserve the pending draft. |
| C8d Fix Pack / agents | Existing guarded API and three validated nonempty generated strings; existing agent status | Generated content is a draft. API generation success does not prove cache persistence, approval or publication. Failed generation/copy cannot show success; scan changes cannot retain another scan's draft. |
| C8e sample report | Separate static `SAMPLE_REPORT`, synthetic flag, reserved `example.invalid` domain | Illustrative score and three example checks are not customer evidence or calculation inputs. No report resolver, signature, view counter or provider call. Existing signed-report lifecycle is unchanged. Localized metadata and derived sitemap include both sample routes; exact demo redirects are temporary 307. |
| C8f alert settings | Existing GET/PUT config DTO and server guards | A failed/malformed response never means Saved; retries and client-switch failures remain visible. Existing Local Trust explicit write boundary, no-snapshot states and notification deduplication remain unchanged. |
| C8g settings | Existing commercial resolver, catalogue prices, persisted status and account-scoped branding gate | Missing/unrecognized status is unknown. Catalogue prices are not an invoice or actual billing state. Existing ordinary portal link and branding/onboarding permissions remain unchanged. |

Unit and offline-renderer evidence does not establish real authentication, Neon data equivalence, Stripe behavior, provider availability, delivery or production readiness. C9–C11 retain their separate material decisions and external approval gates.

## C9a private entities (2026-09-06)

One private canonical brand record per existing client, with at most20 aliases. Names are organizational user input; the DTO always labels verification as unverified. No public profile, discovery route or verification badge is activated.

| Field / operation | Source and tenant boundary | Semantics |
|---|---|---|
| Suggested display name | Owned clients.id/brand_name/account_id lookup | Used only when stored entity is null; GET never inserts, and suggestion is visibly unsaved |
| Stored identity | client_entities joined to clients on id AND account_id | Narrow DTO: clientId,displayName,aliases,revision,verification,updatedAt; no account/actor ids |
| Write | Authenticated account + profile actor; tenant-scoped INSERT SELECT or UPDATE with expected revision | One mutation and separate READ COMMITTED replay query in a transaction; concurrent winner can be seen safely, different stale/future payload conflicts |
| Retry | Same normalized values and older expected revision | Returns stored record without increment; not approval/publication evidence |
| Aliases | Trimmed/NFC-normalized labels, case-insensitive deduplication, display name excluded | Input bounded by16KiB body,20 alias labels and120 Unicode codepoints per label; no provider lookup or scan |
| Failure | Missing/foreign owned client, invalid input, conflict, database/auth outage | Explicit401/400/404/409/500; no failed read presented as empty or failed write as saved |

Migration040 is additive source only, not applied in this task. It carries owned-client and same-account actor foreign keys and explicitly narrows inherited app-role privileges to SELECT/INSERT/UPDATE. Existing brand quotas and roles are unchanged. Live concurrency/SQL/grant proof remains a separately authorized exact-target integration gate.

## C10 local hardening (2026-09-06)

Cron-ledger write failures now emit allowlisted database diagnostics while preserving existing null/no-throw behavior. Three Pulse lookup/producer error responses record ledger status error; HTTP503/502 payloads and job flow remain unchanged. No new no-op/partial taxonomy or scheduler retry guarantee is introduced.

Disposable helper cleanup may only use structurally validated child identities created in the current process. Protected/default/primary/wrong-project/name/root responses cannot enter the cleanup registry; connection lookup failure after valid child identity still permits cleanup. Deletion independently rejects unregistered/protected/invalid ids. The pure pruner excludes default/primary metadata even if its configured protected id is stale. These are locally mocked safeguards, not evidence that any provider cleanup ran.
