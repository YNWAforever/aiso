# AISO / AnsVisor audit follow-up

Continuation: [current audit addendum](./continuation-audit.md) extends this initial pass with F27–F37, a refreshed authenticated reference comparison, security dependency review and new verification. The initial observations and counts below are preserved as historical evidence.

Audit: 2026-10-08 UTC / 2026-10-09 Hong Kong. Source repairs are complete for this bounded pass; production acceptance remains open.

## Version boundary

- Live `aiso-kappa.vercel.app`: deployment `dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2`, main `f49e1bd8951394cf88250b3ea88847d0038db491` (independently read this session).
- Existing unmerged remediation: PR #68, head `8a276a62ec8cd070953bd5c87f85fd88a4481e77`.
- This branch is stacked on #68: `codex/aiso-ansvisor-audit-20261009`.
- Tested application commit: `1b6ffc9` (subsequent documentation commits do not change application behavior).
- AnsVisor repository reviewed at `c50958385bd62866d4a672057148c3f03ceae3f5`; live authenticated reference was inspected independently. No reference code/assets copied.

The F01–F22, T00–T23 and UC01–UC22 registers from the previous delivery remain in force. This follow-up does not convert any prior production/UAT blocker into a pass.

Fresh parent CI read: run37752345060 completed with integration and aggregate-gate failure. Static, unit, build, Worker and all four browser shards succeeded. These are parent receipts, not verification of this new branch.

## New findings

| ID | Severity | Evidence / problem | Repair and verification | Production status |
| --- | --- | --- | --- | --- |
| F23 | High | A public scan of a single-label invalid host produced a score despite zero collected pages. Network failure, HTTP errors and empty origin responses also reached scoring. | Shared input validation; 502 before checks/storage/webhooks for unscannable origin; old explicitly failed reports suppress score, gains, upsell and social/search score claims. API/form/render/metadata regressions failed before and passed after. | Not deployed |
| F24 | High | OpenRouter `message.annotations` was discarded; accepted attempts retained only answer text and detail always said provider citations unrecorded. | Bounded public citation URLs and titles persist atomically in accepted attempt via migration060; detail distinguishes provider annotations, ordinary text URLs, empty annotations and historical unknown. | Migration and deployment pending |
| F25 | High | Empty answers passed the provider boundary and could fail only at ledger commit. Truncated answers could count as observations. Malformed usage could reach integer/numeric storage. | Blank output rejected; explicit non-normal Pulse finish reasons rejected before success; finite nonnegative cost and bounded integer tokens. Tests preserve valid legacy non-Pulse behavior. | Not deployed |
| F26 | Medium | Homepage and sharing promised actual AI recommendations/platform measurement from website readiness checks. | Bilingual homepage, result metadata and share copy distinguish readiness from sampled model API observations. | Not deployed |

Reviewer findings R1/R2 were introduced during this patch and fixed before delivery: migration060 now grants UPDATE only on its two new columns; URL length is checked after normalization to stop Unicode percent-encoding expansion from breaking the database size bound.

## Reference alignment

Authenticated AnsVisor inspection covered visibility, brands, prompt list/detail/raw response, provider sources, citations, action-center KPIs/actions, content opportunities, site audit, AI traffic setup, reports and query fan-out. Existing-account screens were read; no paid analysis, report generation, webhook send, tracking installation or configuration mutation was executed. Private reference account data is excluded from this public repository.

The useful target is a traceable workflow: brand and market → selected prompts → collected answers → separately labelled mentions/citations → evidence-backed opportunities → reviewed work → later comparable observations. AISO's inherited #68 covers much of the workflow structure; this patch repairs its citation evidence boundary. It does not claim complete AnsVisor feature parity. Observed fan-out/search queries, a domain-level citation explorer, demand estimates and verified AI referral analytics remain product gaps or unverified integrations. API model samples cannot be labelled consumer ChatGPT/AI Overviews rankings.

## Fresh verification

| Gate | Result |
| --- | --- |
| Clean dependency install (`npm ci --ignore-scripts`) | Exit 0 |
| Full unit suite | 5,383 passed; 376 files; 0 failed/skipped |
| Lint | Exit 0 |
| Typecheck | Exit 0 |
| Next production build with a synthetic build-only cookie secret | Exit 0 |
| Built-server HTTP smoke | `/en` and `/zh-HK/scan` 200; invalid-host `POST /api/scan` 400 before database/auth work |
| New migration ACL regression | Actual migrations057/060 applied to local PGlite; `aeo_app` can update new evidence columns, cannot update immutable model identity or whole table |
| Independent code review | Two material findings; both reproduced RED→GREEN; final full suite green |
| Guarded Neon round trip | Test added; not executed in this local session |
| Authenticated AISO browser UAT | Blocked by automatic approval review; explicit AISO Google sign-in approval required |
| New live paid provider samples | Not executed |
| Production migrations, merge, deployment and schedules | Not performed |

The first test invocation was blocked over a synthetic `public.example` request. Inspection established that it was a pinned 127.0.0.1 test server; scoped NO_PROXY for that synthetic host and loopback removed proxy routing, and all 42 public-url tests passed. No general network restriction was disabled.

A browser connection to the local server was unavailable in this environment. Built-server HTTP smoke, SSR component tests and live production/reference observations are separate evidence; none is presented as full authenticated browser UAT.

## Release requirements

1. Review this small stacked diff together with #68. Do not merge it directly onto old main without its parent changes.
2. Use the approved isolated UAT database and ordinary runtime role to execute the guarded suites, including the new citation round trip. The local ACL test supplements these gates; it does not replace them.
3. Apply pending expansions054–060 in order with the existing migration runner and migration-owner procedure, after the established backup/rollback checks. Migration060 contains only nullable evidence fields and column-scoped privileges; no credential/password or login-role change is required by this migration.
4. Complete genuine AISO Google login/UAT and collector/classifier/provider evidence checks. Confirm prompt manifests, incomplete-run handling, citation provenance, and tenant separation in the deployed candidate.
5. Verify deployment SHA, current migrations and existing flags before production activation. No flag or schedule should be inferred active from code alone.

Rollback: keep added nullable columns; restore the previously approved application deployment if necessary. Do not destroy evidence to roll back UI/code. Follow #68's existing migration/release procedure for its earlier changes.

## Decisions retained

- Repairs were implemented inline in an isolated branch under the user's explicit fix request; the branch stays reviewable and unmerged.
- Response fixtures now produce a fresh body per fetch, matching actual HTTP responses.
- Historical failed reports are guarded as well as new scans, because otherwise the reproduced report would still display unsupported claims.
- PGlite0.5.8 is a pinned development-only dependency for executable local PostgreSQL ACL coverage; it adds no production service/dependency.
- Live migration, production deployment, authenticated AISO flows, live provider coverage and inherited work remain separate gates. This preserves a pending rollout instead of claiming unverified completion.
- No minor reviewer findings were deferred.
