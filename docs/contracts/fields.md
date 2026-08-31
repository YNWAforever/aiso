# Field contract

Frozen from base plan §10.2, 2026-08-31. Changes require a plan amendment, not a silent edit
here.

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
| Evidence excerpt | `RepoScanCheck.evidence` | — | — | `check_evidence.evidence_json` | first-party evidence | **new** | ≤ N bytes; redaction policy | 3 |
| Evaluated URL | fixture | `baseUrl` (not stored per check) | — | `scan_pages.url` | deterministic check | **new** | equals request after normalisation | 3 |
| Final redirected URL | — | resolved in fetcher, **discarded** | — | `scan_pages.canonical_url` | deterministic check | **new** | differs from evaluated when redirected | 3 |
| Fetched-at timestamp | — | — | — | `scan_runs.started_at` | deterministic check | **new** | distinct from `scans.created_at` | 3 |
| HTTP status + safe headers | — | — | — | `scan_pages.http_status` | provider-documented | **new** | allow-list of headers only | 3 |
| Check version / scanner version / methodology version | `methodVersion: "1.2-demo"` | `PILLAR_SCORE_VERSION` only | — | `scan_runs.*_version` | deterministic check | **new** | present on every new scan | 0/3 |
| Pillar score ×3 | `calculatePillarScore` | `calculatePillarScores` | **not persisted** | `results.pillarScores` | deterministic check | **derived → must become real** | snapshot written and read back | 0/3 |
| Evidence coverage % | `coveragePercent` | — | — | derived | deterministic check | **new** | falls when data missing | 3 |
| Score gate status | `insufficient_evidence`/`provisional`/`scored` | — | — | derived | deterministic check | **new** | 0.67 / 0.85 thresholds | 3 |
| Comparison signature | fixture | — | — | `scan_runs` | deterministic check | **new** | equal scope ⇒ equal signature | 5 |
| Impact / expected uplift | fixture | `lib/impact.ts` | derived | — | estimate | **real, label Estimated** | never stated as guarantee | 3 |
| Observed impact | fixture outcome ledger | — | — | outcome windows | sampled observation | **new** | requires recorded delivery | 5 |
| Entity name / aliases / identifiers | `fixtures.entities` | `clients.brand_name` (partial) | `clients` | brands/products | first-party evidence | **new** | ownership verification | 5 |
| Entity ownership verified badge | fixture | — | — | verification | first-party evidence | **blocked** — needs policy | policy first | 5+ |
| Observation surface / match / role | `fixtures.observations` | `pulse_metrics` (partial) | `pulse_metrics` | `ai_observations` | sampled observation | **new** | valid denominator; failure ≠ absence | 5 |
| Share of voice | — | `pulse_weekly_summary.sov_score` | live | — | sampled observation | **real but never produced** | empty state, not zero | 4 |
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
