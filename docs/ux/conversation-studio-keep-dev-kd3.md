# Conversation Studio keep-dev KD3 visual/a11y hygiene

Engineering hygiene under the existing Stages 0–5 guards. **No product behavior
change.** Base: `44aa1285b745772383a6ce72a156722250b6971b` (`main`, #127 KD2).
Branch: `codex/conversation-studio-keep-dev-kd3`.

Governing brief: supplied `KEEP_BRIEF.md`, identical to
`/workspace/aiso-brief-keep-dev-kd3-visual-a11y.md`. Product pack:
`_fleet_docs/keep-dev-slices.md` **§KD3**, the supplied copy of
`/workspace/docs/superpowers/specs/2026-10-31-aiso-keep-dev-slices.md`.
Sources: [Stage 5](conversation-studio-design-stage-5.md),
[KD1](conversation-studio-keep-dev-kd1.md),
[KD2](conversation-studio-keep-dev-kd2.md), existing Studio browser specs and
[`lib/axe-report.ts`](../../lib/axe-report.ts). The local Next.js 16 Playwright
and Vitest guides were read. The user's handoff overrides the brief's push/PR
step: commit locally; the wrapper pushes and opens one **draft** PR.
Neither the supplied brief nor `_fleet_docs/` is committed.

## Durable evidence

The [visual/a11y matrix](conversation-studio-visual-a11y-matrix.md) defines all
six existing views × 1440/900/390 × light/dark × en/zh-HK, acceptance thresholds,
committed concept references, fixture boundaries and exact regeneration commands.
Stage 5 and KD1/KD2 link to this shared contract while retaining their historical
results. No new Studio view or IA is introduced.

[checks.json](studio-a11y/checks.json) is the golden numeric summary for all
72 Chromium cells; [checks.schema.json](studio-a11y/checks.schema.json) describes
its closed shape. The existing Playwright matrix now attaches actual measured
counts. `scripts/a11y/studio-matrix.mjs` promotes only successful, complete
Chromium measurements and stores product/CSS/report provenance hashes. Raw axe
HTML/selectors, URLs, prompts, records and screenshot trees are excluded.

The dedicated **soft proof** command is
`node scripts/a11y/studio-matrix.mjs --check`. It exits nonzero for a missing or
invalid receipt, any missing/duplicate cell or any nonzero acceptance metric,
including serious/critical axe violations. It does not change the aggregate CI
gate. Fifteen focused validator tests exercise partial proof, failed/retried
reports, wrong dimensions, absent counts, nonzero metrics and extra page content.
The checker validates recorded evidence, not arbitrary future source freshness.

## Verification and boundaries

Node 24.22.1; existing lockfile dependencies reused through a gitignored symlink
to `/workspace/cli-aiso-kd1/node_modules`. No install or dependency edit. The
Studio JS fixtures were regenerated from this checkout using the existing two
component test files. Production CSS was reused from
`/workspace/cli-aiso-kd2/.next/component-fixtures/STUDIO/build.css`: that checkout's
`app`, `components`, `lib`, `messages`, Next/PostCSS config and package/lockfile
inputs have no diff against this base. The golden stores the exact CSS hash.
This docs/harness slice does **not** claim a fresh production build; the existing
[build-validation gap](../development.md#observed-build-validation-gap) remains.

Offline fixtures render production components with synthetic records, a Next
navigation shim and intercepted B2 replies. They block unexpected requests and
do not load local env files. Only process-local test variables are used.
**Hosted Neon/Auth/integration: N/A / not run.** Its harness provisions real Neon
and runs migrations, outside this authorization. In-memory unit contracts and
synthetic account changes do not establish hosted tenancy/provider acceptance.

Local validation is recorded below. Logs and raw captures stay under
`/workspace/cli-logs/aiso-kd3*`; none is committed.

| Check | Result | Log suffix |
| --- | --- | --- |
| `npm run lint` | Pass, 0 errors/warnings | `lint.log` |
| `npm run typecheck` | Pass, including generated route types | `typecheck.log` |
| `npm run audit:text` | Clean | `text-audit.log` |
| Focused Studio/receipt/axe units | 15 files / 148 tests pass | `focused-unit.log` |
| Offline Studio fixture regeneration | 2 files / 21 tests pass | `fixtures.log` |
| Full `TZ=UTC CI=1 npm run test:unit -- --maxWorkers=2` | 537 files / 7,161 tests pass | `unit.log` |
| Chromium + mobile Studio E2E | 104/104 pass, no skips; 72 matrix cells per project | `e2e.log` |
| Durable receipt promotion + focused soft check | 72/72 unique Chromium cells pass | `matrix.log` |
| Runtime/CSS scope + exact Vercel config comparison | Pass | `scope-check.json` |
| Hosted Neon/Auth/integration | N/A / not run | Outside authorization |

The golden covers all 72 Chromium cells, with zero total/serious/critical axe
violations, horizontal overflow, undersized text/controls and unexpected
requests. Mobile runs the same 72 cells. Optional Chromium output contains 96
captures including brief/composer states; the screenshots are ephemeral evidence,
not committed pixel baselines. A zh-HK 900px discussion and en 390px dark home
were spot-inspected against the concept hierarchy/token rules. No visual fix
was required or made.

Dashboard isolation is supported by rerun same-brand exits and chrome/session
restoration cases in both locales/projects. Product runtime, global/Studio CSS,
DashboardChrome and DashboardSidebar are byte-identical to the base. No new
dashboard pixel-diff or hosted acceptance is claimed. B1/B2, KD1 toast/I5,
KD2 context carry/draft isolation, Stage 4 inspector, Layout B and feature-flag
defaults are preserved. Local checks do not claim CI green.

## NO_GOs and handoff

**Stage 6a–6h NO; Production FEATURE OFF untouched.** No Production FEATURE ON,
Preview/Production settings or env writes, local env-file writes, Neon
connections/persistence/schema/migrations, work-item saves/writes, source
attachments into prompts, new model/vendor calls or spend, GSC/DFS/Firecrawl
query/connect, Layout A, invented views, CloudAgent, merge, push or PR creation.
No product file, route, flag, quota, B1/B2 transport or paid service changes.

`vercel.json` adds only this branch's exact deploy-disable entry. A parsed
comparison against base, after removing that one entry, confirms every existing
entry and setting is preserved. No screenshot/binary dumps are committed.

Handoff files: `/workspace/cli-logs/aiso-kd3.pr-title.txt`,
`/workspace/cli-logs/aiso-kd3.pr-body.md` and
`/workspace/cli-logs/aiso-kd3.tip-sha.txt`. The wrapper handles push and draft PR
creation. **Hold Extra High PR-diff review until CI is green and AISO re-briefs.
Do not merge.** Ready → Grok Master for the GM merge Ask.
