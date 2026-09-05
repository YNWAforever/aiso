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
