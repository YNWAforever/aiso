# Conversation Studio design — Stage 2

Willy continuous **Stages 0–5 Approve**, via Rio Ask **t130s893**,
2026-10-29 HKT. Base: **`2c1ce2999a3f00170ee8d4d7831e4484f7f39e66`**
(Stage 1, #121 squash merge). `HEAD` and `origin/main` matched that base at
preflight. Stage 2 is **DESIGN + light READ: GSC binding status only**.

The authoritative input is `/workspace/aiso-brief-studio-design-stage-2.md`,
with the gap plan Stage 2 / §3.4 and the committed concept
[TOKENS](conversation-studio-concept/TOKENS.md),
[VIEWS](conversation-studio-concept/VIEWS.md),
[STRINGS](conversation-studio-concept/STRINGS.md),
[README](conversation-studio-concept/README.md),
[Home](conversation-studio-concept/screenshots/01-home.webp) and
[Discussion](conversation-studio-concept/screenshots/02-discussion.webp).

## Implementation

The existing `/studio` route now starts with hero → goal composer → source
status → five category filters → six two-column task cards → “Continue
working”. Mobile cards stack. Selecting any task fills and focuses the
composer; send creates a temporary thread and replaces home with discussion
(thread heading, turns and follow-up composer). Returning to “Start work”
reveals only this page session’s threads; selecting a row restores its turns
and isolated draft. Reload and brand remount still clear everything.

`lib/conversation-studio/home.ts` maps six presentation tasks onto the existing
four B1 capabilities. Opportunity uses saved evidence and a plain link to the
owned brand’s existing `/opportunities`; improve uses only the loaded owned
scan, never Pulse observations; brief/competitors/pulse/report retain their
existing capabilities, with report linking to `/reports`. `composeSavedReply`,
the B2 POST body/endpoint, provider orchestration, flags and default-zero cap
are unchanged. There is no opportunity-engine invocation or new provider call.

The server page reads `loadBinding(session.account_id, clientId)` only after
ownership and the existing Search Console feature/plan gates. It projects
bound, unbound, reconnect and rebind states without exposing property IDs,
credentials or metrics. Disabled access and read failures say “Pending
verification”, never “Not connected”. The source bar explicitly says this is
binding status only and no search data was queried. It does not sync or call
Google. Existing store SQL enforces account scope.

The composer footer contains the disabled “Choose documents” control, locale
badge, quiet expandable live-platform control and send action. Existing
multi-platform behavior, per-send quota disclosure, process-local limit,
unverified live output and unknown-search-execution semantics remain reachable.
Saved/live replies retain Stage 1 presentation; Stage 3 polish is not included.

Both catalogs use concept hero, filters, task titles/descriptions/outcomes and
empty-state copy. Prompts refer to the current brand instead of the concept’s
sample air purifier/home products. Follow-up placeholder keeps only the
supported “Ask a follow-up…” portion. Every task has explicit unsupported or
pending-verification copy beside its aspirational outcome chain and again in
discussion. Amber details preserve scope, missing-is-not-zero and Mentions
coverage limits. Stage 1’s localized Chinese eyebrow and Fimmick AISO answer
label remain. The exact approved “AISO 已保存資料” / “Data saved in AISO”
source label gets a locale/key/text-specific naming-audit exception; tests
prove other keys and changed values still fail.

All CSS and 11 `--as-*` tokens remain scoped to `#aiso-studio`, including dark
overrides. New text is at least 12px and interactive targets at least 44px;
there is no CJK webfont or global theme change. `vercel.json` adds only
`codex/conversation-studio-design-stage-2: false`, preserving every prior
deployment-disable entry including Stage 1.

## Verification and evidence

All work runs locally in the supplied Codex CLI, single executor, with Stage 1
`node_modules` reused; the lockfile is unchanged. No other agents or cloud task
execution. Logs: `/workspace/cli-logs/aiso-studio-stage-2.*.log`.

Browser checks use production components in the existing isolated fixture
harness, synthetic saved evidence and intercepted B2 responses. They prove UI
behavior, not hosted Auth, real GSC binding availability or live-provider
acceptance. Unit checks use `CI=1` fetch guard and two workers; browser checks
use one Playwright worker. Fixture variables are per process only.

Screenshots: `/workspace/cli-logs/aiso-studio-stage-2-shots/`,
`studio-{en,zh-HK}-{light,dark}-{1440,900,390}-{home,discussion}.png`, plus
dashboard home captures and `checks.json`. The retained capture script is
`/workspace/cli-logs/aiso-studio-stage-2.capture.cjs`. It checks axe, reflow,
text/target sizes, focus and blocked outbound requests; dashboard capture hashes
compare the same home fixture with and without retained Studio CSS.

Hosted integration is **blocked / not run**. `npm run test:integration` loads
`__tests__/integration/setup.ts` and `createTestBranch()` in
`__tests__/helpers/neon-branch.ts`, provisioning a real Neon branch, resetting
its public schema and applying migrations. This delivery forbids those actions.
The Studio SQL fixtures in the unit suite use in-memory PGlite and mocked HTTP;
they do not substitute for managed-Neon acceptance. The local PR-gate aggregator
also cannot pass without the six CI job outcomes and summaries; no missing
evidence is fabricated. Exact final results are recorded in the draft PR.

Initial checks caught missing filter catalog keys and the approved shorthand’s
naming-audit conflict. Browser acceptance caught the discussion heading-level
gap introduced by removing home headings; the discussion now provides its own
semantic heading. A reload assertion was updated to expect the removed log.
Generated traces from intentional red checks were cleaned up before final lint.

Final local results (all final commands exited 0 except the documented gate):

| Check | Result | Log suffix |
| --- | --- | --- |
| `npm run lint` | 0 errors/warnings | `lint-verified.log` |
| `npm run typecheck` | Pass | `typecheck-verified.log` |
| `CI=1 npm run test:unit -- --maxWorkers=2` | 531 files, 7,101 tests pass | `unit-verified.log` |
| `npm run build` | Pass, Next.js 16.3.8 Turbopack | `build-verified.log` |
| Existing component fixture preparation | 26 files, 157 tests pass | `fixtures-verified.log` |
| Studio Playwright, Chromium + mobile, one worker | 40/40 pass, en + zh-HK | `e2e-verified.log` |
| Screenshot/accessibility matrix | 24 Studio captures, 0 axe violations; reflow/text/targets/focus pass | `visual-verified.log` |
| Dashboard isolation | Four light/dark en/zh-HK cases pixel-identical | `visual-verified.log` |
| Hosted integration | Blocked / not run: provisions Neon branch | `integration.log` |
| Local PR-gate aggregator | Exit 1: six CI outcomes/summaries absent | `pr-gate.log` |

All log suffixes are under `/workspace/cli-logs/aiso-studio-stage-2.`.

## Holds

**Stage 6 NO; Production FEATURE OFF.** No new spend/model/vendor calls,
opportunity-result wiring, env writes (local, Preview or Production), database
changes/migrations, thread persistence/ACL, real file attachment, work-item
saves, fake vendor/GSC data or concept records in product UI. No Stage 3
discussion polish/research theatre, Stage 4 inspector, Stage 5 Layout B shell,
Studio sidebar or secondary routes. Layout B full-bleed is approved for Stage 5,
not this PR.

Draft PR only. No merge, ready-for-review action or PR-diff/Codex review.
After draft PR + tip SHA: **STOP; HOLD until CI green and AISO re-briefs**.
