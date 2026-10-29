# Conversation Studio design — Stage 3

Willy continuous **Stages 0–5 Approve**, via Rio Ask **t130s893**,
2026-10-29 HKT; Stage 2 **#122** squash merge Approve **t154s996**.
Base: **`8fc539c6cf89c905b62771b380197e6cb8b9179f`**. HEAD and origin/main
matched this base at preflight. This delivery is **Stage 3 DESIGN** only.

The authoritative input is `/workspace/aiso-brief-studio-design-stage-3.md`,
with the gap plan Stage 3 / §3.4 and the committed concept
[TOKENS](conversation-studio-concept/TOKENS.md),
[VIEWS](conversation-studio-concept/VIEWS.md),
[STRINGS](conversation-studio-concept/STRINGS.md),
[README](conversation-studio-concept/README.md) and inspected
[Discussion](conversation-studio-concept/screenshots/02-discussion.webp)
([Home](conversation-studio-concept/screenshots/01-home.webp) for context).
The Next.js 16 local Server and Client Components and CSS guides were read
before editing. Everything runs in the supplied local Codex CLI at Extra High,
with no agents, cloud tasks, dependency reinstall or duplicate dependency tree.

## Discussion composition

The existing home/discussion split now gives each temporary thread a stable
title from its original goal or task, a `DISCUSSION / RESEARCH` eyebrow (or
`CONTENT BRIEF` for the brief template and branched briefs), the Hong Kong /
Traditional Chinese scope and its actual loaded saved-week date, when present.
The period badge identifies the saved week; it never invents a last-28-days
range. Document attachment remains disabled, so no selected-document badge
is rendered. The user bubble is inset 30px, followed by “AISO · 回答” /
“AISO · Answer”, research details and saved result cards. Scope/limits,
process-local quota and temporary-memory disclosures remain reachable.

`composeSavedReply` returns research-step metadata from that turn’s filtered
inputs and actual output. Reading a loaded week is listed only when there
are observation candidates and a real saved week. Selection is listed only
when candidates or an included scan exist. Extraction is listed only when
there is answer text or scan checks to present. An unmatched question may
show selection without extraction; scan-only improvement never claims a
Pulse-week step; empty inputs show an explicit no-records message. These are
local saved-data steps, never completed vendor research or a new week fetch.

B1 uses `as-result` cards with kickers, h3 headings, saved-state badges and
“搜尋需求：待核實”. “查看證據” opens the existing coverage/source details
and focuses the corresponding source record. It performs no fetch and opens
no inspector aside. Historical quotes, observation and scan IDs, platform,
time, citation provenance and unknown-search-execution copy remain available.
The explicit answer shorthand has an exact locale/key/value naming-audit
exception and regression coverage. Other product naming remains Fimmick AISO.

B2 remains a separate, vertically stacked card with an amber border and a
different surface, headed “即時模型輸出 · 未經核實”. Its original unverified
warning, missing-is-not-zero, quota, search execution, provider metadata and
safe-link behavior remain. The POST shape, backend, default-zero cap and
provider orchestration are unchanged; live output is never written to Pulse
or metrics. No rankings, market numbers or mock concept records are added.

## Session-temp brief discussions

“另開 brief 討論” immediately creates a **new React-state-only thread** with
the source title, original goal and saved-week scope. Its context notice and
editable brief draft carry that goal. The new thread starts with **no turns**;
branching does not compose an answer or dispatch a model call. Only explicit
send starts a turn, using the existing B1/B2 path. B2 still sends only the
current draft and selected platforms, without silently attaching saved records
or conversation history.

Both source and brief appear in “繼續工作”. Each retains its own turns and
draft; changing the new draft does not alter the source. Enter adds a newline,
IME Enter does not send, and navigation restores composer focus. **Reload,
leaving the page or changing brands clears both threads, drafts and context.**
There is no browser storage, Neon persistence, durable private ACL or saved
work item. The original source draft is preserved when branching.

CSS extends only `conversation-studio.css` under `#aiso-studio`, including
the existing 11 tokens and dark overrides. New UI text is at least 12px and
interactive targets at least 44px. No CJK webfont, global theme change or
Stage 5 shell is introduced. `vercel.json` adds exactly the Stage 3 branch
`git.deploymentEnabled` entry set to false, preserving all existing entries.

## Local verification

Logs: `/workspace/cli-logs/aiso-studio-stage-3.*.log`. Unit checks use `CI=1`
fetch protection and two workers; Playwright uses one worker. Dependencies
and package-lock.json are reused unchanged. Fixture variables are isolated
per-process; no local, Preview or Production environment files/settings change.

Browser checks render real production components in the existing offline
fixture harness with synthetic saved records and intercepted B2 responses.
This is UI acceptance evidence, not hosted Auth, real provider or managed-Neon
acceptance. Screenshot/accessibility captures are retained under
`/workspace/cli-logs/aiso-studio-stage-3-shots/` with the script
`/workspace/cli-logs/aiso-studio-stage-3.capture.cjs`:
`studio-{en,zh-HK}-{light,dark}-{1440,900,390}-{home,discussion}.png`, dashboard
home captures and `checks.json`. Additional `*-discussion-saved.png` captures
show the saved-only research composition; two zh-HK `*-brief-temp.png` captures
show carried context at 1440 light and 390 dark. Research details are expanded in discussion
captures for inspection. The matrix checks axe, reflow, font/target size,
focus and unexpected outbound requests, and compares dashboard home pixels
with and without the retained Studio stylesheet.

The final serialized unit run passes **531 files / 7,105 tests**. Component
fixture preparation passes **26 files / 159 tests**. Studio Playwright passes
**48/48** on Chromium and mobile, en + zh-HK. Typecheck, production build and
the text audit pass. Exact final log references and the visual/lint results
are included in the draft PR.

| Final check | Result | Log suffix |
| --- | --- | --- |
| `npm run lint` | 0 errors/warnings | `lint-verified.log` |
| `npm run typecheck` | Pass | `typecheck-verified.log` |
| `CI=1 npm run test:unit -- --maxWorkers=2` | 531 files / 7,105 tests pass | `unit-verified.log` |
| `npm run build` | Pass, Next.js 16.3.8 Turbopack | `build-verified.log` |
| Component fixtures, CI=1, one worker | 26 files / 159 tests pass | `fixtures-verified.log` |
| Studio Playwright, one worker | 48/48 pass, Chromium + mobile, en + zh-HK | `e2e-verified.log` |
| Screenshot/accessibility matrix | 42 captures; zero axe violations; reflow/text/targets/focus pass | `visual-verified.log` |
| Dashboard home isolation | Four en/zh-HK light/dark cases pixel-identical | `visual-verified.log` |
| Text audit | Clean | `text-audit-verified.log` |
| Hosted integration | Blocked / not run: provisions Neon branch | `integration.log` |
| Local PR-gate aggregator | Exit 1: required CI outcomes/summaries absent | `pr-gate.log` |

All log suffixes use `/workspace/cli-logs/aiso-studio-stage-3.`. The final
captures include 38 Studio images and four dashboard images. B2’s different
surface and 3px amber border are also checked from computed styles, preventing
CSS ordering from silently overriding its distinct presentation.

Earlier overlapping checks hit a Vitest worker startup timeout and browser
fixture-load/test timeouts. The checks were rerun without overlap. Lint also
encountered generated Playwright trace-viewer JavaScript from those failed
runs; those disposable trace assets were removed before the final lint check.
Initial failure logs are retained; no test assertion or timeout was relaxed.

Hosted integration is **blocked / not run**. `npm run test:integration` loads
`__tests__/integration/setup.ts` and `createTestBranch()` in
`__tests__/helpers/neon-branch.ts`, provisioning a real Neon branch, resetting
schema and applying migrations. The brief forbids those actions. The existing
PGlite SQL suites run in the unit layer and do not substitute for hosted
integration acceptance. The local PR-gate aggregator exits 1 when the six
required CI job results/summaries are absent; no green evidence is fabricated.

## NO_GOs and delivery hold

**Stage 6 NO; Production FEATURE OFF.** No Stage 4 evidence inspector aside,
Stage 5 Layout B full-bleed shell, Studio sidebar or secondary routes. Layout B
is approved for Stage 5, outside this PR. No Stage 6 backend, new model/vendor
calls or spend, opportunity-result integration, env writes (local/Preview/Prod),
Production FEATURE ON, Neon thread persistence, DB changes/migrations, work-item
saves, real file attachment, fake completed vendor steps, fake live data or
concept mock records in product UI.

Draft PR only: no merge, marking ready, review requests, messages to anyone or
PR-diff/Codex review. After draft PR + tip SHA: **STOP; HOLD until CI green and
AISO re-briefs**. CI status may be read briefly without waiting for green.
