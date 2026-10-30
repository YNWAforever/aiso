# Conversation Studio keep-dev KD2 discussion polish

DESIGN only, under the existing Stages 0–5 approval (Rio Ask `t130s893`).
Base: `fff4a885fb78dd89ee4004c8e0b3d3bd64a16e51` (#126, KD1).
Branch: `codex/conversation-studio-keep-dev-kd2`.

Governing brief: supplied `KEEP_DEV_KD2_BRIEF.md`, also at
`/workspace/aiso-brief-keep-dev-kd2-discussion.md`. Product pack:
`_fleet_docs/superpowers/specs/2026-10-31-aiso-keep-dev-slices.md` §KD2.
The residuals are X3 and discussion honesty in
`_fleet_docs/aiso-studio-design-gap-and-plan.md` (the supplied copy of
`/workspace/aiso-studio-design-gap-and-plan.md`). Design references:
[VIEWS](conversation-studio-concept/VIEWS.md),
[STRINGS](conversation-studio-concept/STRINGS.md),
[TOKENS](conversation-studio-concept/TOKENS.md),
[Discussion](conversation-studio-concept/screenshots/02-discussion.webp),
shipped Stages [3](conversation-studio-design-stage-3.md),
[4](conversation-studio-design-stage-4.md),
[5](conversation-studio-design-stage-5.md) and [KD1](conversation-studio-keep-dev-kd1.md).
The local Next.js 16 client-component, CSS and Playwright guides were read.
The user’s handoff overrides the brief’s push/PR step: commit locally and write
PR title/body files for the parent to create one **draft** PR.

## Discussion behavior and session-temp honesty

“另開 brief 討論” now takes context from the specific result card that was
activated, including earlier cards in a discussion with multiple turns. The
new thread retains the source title, original goal, actual saved week and
`CONTENT BRIEF` eyebrow. Its editable seed contains the original user goal,
selected turn’s user question and the saved result’s displayed status/caveat,
including “搜尋需求：待核實”. Long user text is visibly abbreviated to keep
the complete seed within the existing 1,000-character composer/transport limit;
the uncertainty wording is retained. The composer receives focus with its cursor
and scroll position at the start of the seed, so the opening goal is visible.

The seed carries no document body, historical answer extract, live model answer,
hidden source metadata or full conversation history. Document selection remains
disabled under Stage 6a: there are no selected documents and therefore no
selected-document badges to invent. Read-only approved documents in the inspector
do not mean they were selected or attached. The branch starts with no turns and
dispatches no request. Only explicit Send follows the existing B1/B2 path,
with B2 still sending exactly the current draft, platforms and language.

Drafts remain owned by their thread. Selecting another thread shows that
thread’s own draft; returning restores it, following the shipped Stages 3–5
behavior. Branching does not overwrite the source’s unsent text. The shell’s
recent-thread and thread-list navigation now restores composer focus too.
Navigation invalidates old inspector selections and clears success feedback,
including when the same thread is selected again. No stale evidence from another
thread is opened. The standalone component also remounts its memory provider
when its brand changes; the guarded Layout B provider keeps the existing
`account_id:clientId` identity.

Switching brands/accounts, leaving Studio or reloading discards the entire
temporary session. Returning to a previous brand/account does not recover its
threads or unsent text. Studio’s four READ pages retain the current session as
in Stage 5. There is no browser storage, Neon persistence, durable private ACL
or saved work item.

KD1’s existing pre-mounted `as-toast` region remains the only feedback region,
with `role="status"`, `aria-live="polite"` and `aria-atomic="true"`.
Brief-success copy still explicitly says temporary. Follow-up Send now announces
that the message was added to the temporary discussion. That acknowledges the
local turn, not completion or verification of an optional live request; pending,
quota failures and partial live answers retain their separate honest states.
Announcements use fresh turn/thread IDs and clear on thread navigation.

The B1 search-demand badge, B2 unverified heading, amber warnings, research-step
disclosure, missing-is-not-zero explanation and Stage 4 inspector remain in their
existing locations. Keyboard tests use Tab/Enter/Escape to reach both saved/live
evidence and the disclosures. No API, provider orchestration, flags, quota,
default-zero behavior, saved-data composition or READ-page data loader changes.
KD1’s same-brand I5 links and Layout B shell remain intact.

## Visual and verification evidence

Checks use the existing Node 24/dependency installation, CI unit fetch protection,
`TZ=UTC`, two unit workers and one browser worker. Browser fixtures render the
actual production components with synthetic records and intercepted B2 responses.
They attempt no real vendor, hosted Auth or Neon request. The account-switch
fixture uses the same account:brand provider key that the guarded layout’s unit
test verifies; it does not implement or prove an account-switching auth flow.

| Check | Result | Log under `/workspace/cli-logs/` |
| --- | --- | --- |
| `npm run lint` | 0 errors/warnings | `aiso-kd2.lint-final.log` |
| `npm run typecheck` | Pass from generated `next typegen` types | `aiso-kd2.typecheck-final.log` |
| `npm run audit:text` | Clean | `aiso-kd2.text-audit.log` |
| Focused Studio units | 13 files / 132 tests pass | `aiso-kd2.focused-unit.log` |
| Full `TZ=UTC CI=1 npm run test:unit -- --maxWorkers=2` | 536 files / 7,146 tests pass | `aiso-kd2.unit-final.log` |
| Offline component fixture preparation | 2 files / 21 tests pass | `aiso-kd2.fixtures-final.log` |
| Focused Studio E2E, Chromium + mobile | 104/104 pass, en + zh-HK, no skips; includes 12 Chromium capture cells | `aiso-kd2.e2e-final.log` |
| Default `npm run build` | Blocked by supplied cross-workspace `node_modules` symlink | `aiso-kd2.build.log` |
| `npm run build -- --webpack` | Compiles; fails existing route-export validation | `aiso-kd2.build-webpack.log` |
| Hosted Neon/Auth/integration | N/A / not run; outside authorized scope | See NO_GOs below |

The supplied `node_modules` symlink points to `/workspace/cli-aiso-kd1/node_modules`,
outside `turbopack.root` for this checkout. No dependency reinstall, copying or
configuration workaround is performed. The webpack fallback produces production
CSS and compiles, then reports the same four helper exports already documented
in [development’s build-validation gap](../development.md#observed-build-validation-gap):
`parseFixPack`, `assignGrade`, `claimScanForAccount` and `provisionAccountForUser`.
Those routes are unchanged. After removing only generated `.next/types` left by
webpack, the normal `next typegen && tsc --noEmit` check passes. No source check or
type error is suppressed. Production build acceptance remains unproven.

The visual fixtures use the final webpack-compiled production CSS. Captures
are in `/workspace/cli-logs/aiso-kd2-shots/`; the side-by-side review artifact is
`/workspace/cli-logs/aiso-kd2-comparison.html`, with test-derived receipts in
`aiso-kd2-shots/checks.json`. Each cell has a discussion capture, the new temporary
brief and a focused composer detail, plus the existing home/four READ-page captures
(96 images altogether). All cells assert zero axe violations, including zero
serious/critical violations, and no horizontal overflow. Existing screen checks
also assert ≥44px controls and ≥12px text. Brief checks assert focused editing
and the temporary-success announcement.

| Locale | Width | Light | Dark |
| --- | ---: | --- | --- |
| en | 1440 | Pass | Pass |
| en | 900 | Pass | Pass |
| en | 390 | Pass | Pass |
| zh-HK | 1440 | Pass | Pass |
| zh-HK | 900 | Pass | Pass |
| zh-HK | 390 | Pass | Pass |

Comparison with `02-discussion.webp` retains the header/scope badges, 30px
question inset, blue answer label, research disclosure, result cards, amber
honesty and follow-up composer. Actions wrap at 390px; the rail remains 205px,
178px at 900px and collapsed at mobile widths. Brief captures exposed the
textarea’s initial caret-at-end scroll: new branches now start the caret at the
opening goal. No additional CSS or copy nits were needed. The reference is a desktop light mock,
not a responsive/dark pixel baseline; those cells use its documented tokens
and breakpoints. Layout B is full-bleed, and product uncertainty copy/44px
targets/12px text intentionally remain. Captures reset top-of-view framing;
long discussion content scrolls inside the shell, with separate composer crops
showing the editable seed.

Dashboard home isolation is unchanged: global CSS, Studio CSS, DashboardChrome
and DashboardSidebar are byte-identical to the base. The browser tests exercise
KD1’s same-brand opportunities/reports/tools exits for both brands and locales,
restore dashboard chrome and prove that returning to Studio starts empty.
`aiso-kd2.scope-check.json` also verifies unchanged B1/B2 reply/inspector components,
flags, B2 transport and quota, and the exact single Vercel entry addition.
Raw final browser receipt: `aiso-kd2.playwright-full.json`.
CI results are not claimed by local checks.

## NO_GOs and handoff

**Stage 6a–6h NO; Production FEATURE OFF remains untouched.** No Prod FEATURE ON,
Preview/Production settings or local env-file writes, Neon connections or
persistence, schema/migrations, work-item writes/save, source attachment into
prompts, new model/vendor calls or spend, GSC/DFS/Firecrawl query/connect,
Layout A, IA rewrite, new views, CloudAgent, merge, push or PR creation.
No dependencies are installed or copied. Only process-local test variables are
used. Hosted Neon/Auth/integration acceptance is **N/A / not run**: its harness
provisions a real Neon branch and runs migrations, outside this authorization.
Offline fixtures and in-memory SQL contracts do not establish hosted acceptance.

`vercel.json` adds only this branch’s exact deploy-disable entry, preserving
all prior entries including KD1 and all other settings. The supplied brief and
`_fleet_docs/` are not committed.

Handoff: `/workspace/cli-logs/aiso-kd2.pr-title.txt` and
`/workspace/cli-logs/aiso-kd2.pr-body.md`. Parent pushes and creates the single
draft PR. **Hold Extra High PR-diff review until CI is green and AISO re-briefs;
do not merge.**
