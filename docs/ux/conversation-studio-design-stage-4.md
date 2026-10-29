# Conversation Studio design — Stage 4

Willy continuous **Stages 0–5 Approve**, via Rio Ask **t130s893**, 2026-10-29
HKT. Stage 3 **#123** was squash-merged through the **t154s996** lineage.
Base: **`0176d84e99dfa85f95d6416b8434db8e44a9848d`**. HEAD and origin/main
matched that base after `git fetch origin` at preflight. This delivery is
**Stage 4 DESIGN + READ**, draft PR only.

The authoritative brief is `/workspace/aiso-brief-studio-design-stage-4.md`,
with Stage 4 and the honesty lines in `/workspace/aiso-studio-design-gap-and-plan.md`.
Design references: [TOKENS](conversation-studio-concept/TOKENS.md),
[VIEWS](conversation-studio-concept/VIEWS.md),
[STRINGS](conversation-studio-concept/STRINGS.md),
[README](conversation-studio-concept/README.md), inspected
[Discussion](conversation-studio-concept/screenshots/02-discussion.webp), and
shipped design Stage [1](conversation-studio-design-stage-1.md),
[2](conversation-studio-design-stage-2.md), [3](conversation-studio-design-stage-3.md).
The local Next.js 16 Server and Client Components and CSS guides were read
before editing. Work runs in the supplied local Codex CLI at Extra High,
without other agents or cloud task execution. Existing dependencies and the
lockfile are reused; no dependency tree is copied or installed.

## Inspector and evidence honesty

“查看證據” now opens one **本次證據** aside for the selected answer. Above
900px it occupies a 240px right grid column. At 900px and below it stacks after
the answers and before the follow-up composer. This follows the concept's
explicit ≤900 breakpoint. It stays in the Studio DOM so scoped colors apply;
there is no new shell, sidebar, portal or route. The existing Radix dialog
primitive traps focus, handles Escape and restores the originating card button
on close. Observation and live-platform actions focus their specific provenance
record; the saved-summary action starts at Close. The scrollable aside keeps
long records within the viewport. Both catalogs provide all new UI copy.

The page loads existing owned metadata only after authentication, the Studio
feature gate, brand validation and account ownership:

- **品牌文件:** `loadStudioDocuments` calls the existing sources service,
  which independently authorizes the session and uses its account-scoped paged
  reader. Only current approved, non-revoked versions are projected into the
  inspector: label, version identity/number, import time and approval time.
  Agent-use permission is not represented as attachment or use in this answer.
  The bounded source page discloses truncation. Successful emptiness says
  “未有紀錄”; denied or failed reads say “待核實”. Source contents, actor
  identity and approval controls never enter the client projection or prompt.
- **Search Console:** retains Stage 2 binding status and existing feature/plan
  gates, reads saved state with `loadPanelData`, and derives sync state with
  `deriveOwnerState`. Existing binding-generation rules reject obsolete ledger
  state. Only state and actual saved data-through dates reach the inspector;
  metrics, property IDs and connection credentials are not exposed. A failed
  sync-state read remains pending even when binding itself was read successfully.
  **Every turn says “本次未查詢”**. There is no Google request, sync action or
  invented HK filter, reporting period, ranking or query result.
- **DataForSEO / Firecrawl:** “未連接”, with no connect action or vendor client.
- **AI 引用:** selected-turn B1 coverage, observation IDs, source links, scan ID,
  platform/question/week, model/market, recorded/collected times and search
  uncertainty move from inline coverage into the aside. B2 metadata and safe
  citations move into a separate unverified live section, retaining platform,
  started-at, duration, model, finish reason, grounding and confirmed/unknown
  search status. The original turn prompt remains visible. AI citations are
  explicitly separate from search performance. An unrelated later answer cannot
  inherit the previous answer's evidence. The answer cards retain historical
  quotation warnings, saved/live distinctions, partial failures and missing-is-not-zero.

The original bounded coverage explanation is preserved: **present does not
mean fully answered; missing does not mean zero mentions or no activity**.
The footer says **「缺少資料時顯示『待核實』，不填入推算數字。」**.
Opening/closing the inspector performs no fetch. B1 composition and B2's
explicit-send POST shape, model orchestration, flags and default-zero cap are
unchanged. Documents are never attached to the model. All thread, draft,
branch-brief, IME/newline and reload-reset behavior remains page-local.

CSS extends only `conversation-studio.css` under `#aiso-studio`: light/dark
scoped tokens, 12px minimum new text, 44px interactive targets. No CJK webfont
or global theme rewrite. `vercel.json` adds exactly
`codex/conversation-studio-design-stage-4: false` in `git.deploymentEnabled`,
preserving every previous entry and all other configuration.

## Local verification

Logs use `/workspace/cli-logs/aiso-studio-stage-4.*.log`. Unit checks use
`CI=1` fetch protection and two workers; Playwright uses one worker. Build,
fixture preparation and browser checks run sequentially. Fixture variables
are per process only; no local, Preview or Production environment file or
setting is written.

Browser checks render actual production components in the existing offline
fixture harness with synthetic saved/source/connector metadata and intercepted
B2 responses. These establish UI behavior, not hosted Auth, real sources/GSC
availability or provider acceptance. Unit tests establish source projection,
approval/revocation filtering, failure versus empty states, account arguments,
feature/ownership gates, state derivation and absence of secret/metric props.
Browser checks establish inspector wiring, Close/Escape, focus containment and
restoration, selected-turn isolation, safe URLs, no request on open and reflow.

Screenshots and checks: `/workspace/cli-logs/aiso-studio-stage-4-shots/`, using
`/workspace/cli-logs/aiso-studio-stage-4.capture.cjs` (based on the Stage 3
capture pattern). The matrix includes en/zh-HK × light/dark × 1440/900/390,
`studio-{en,zh-HK}-{light,dark}-{1440,900,390}-inspector-{open,citations}.png`,
plus four dashboard home captures and `checks.json`. Top and citation views
show the same scrollable aside. Dashboard home screenshots compare pixels
with/without retained Studio CSS and assert no Studio token on the body.
The 24 Studio captures and four dashboard captures pass: zero axe violations
with the inspector open and closed, no page overflow, no text below 12px or
interactive target below 44px, correct 240px/stacked geometry, contained focus,
Escape restoration and no unexpected requests. All four dashboard comparisons
are pixel-identical. Desktop light, mobile zh-HK dark and dashboard home images
were also visually inspected. The initial browser run caught an invalid native
aside/dialog ARIA combination (48 existing cases passed, four new cases failed).
The dialog now sits inside the aside; scrolling stays inside its focus boundary.
Final browser acceptance passes 52/52. Initial failure logs are retained;
disposable trace/video/report assets were removed to conserve inodes.

Hosted integration is **blocked / not run**: `npm run test:integration` loads
`__tests__/integration/setup.ts` → `createTestBranch()` in
`__tests__/helpers/neon-branch.ts`, provisions a real Neon branch, resets its
public schema and applies migrations. This brief forbids that workflow.
Existing in-memory PGlite SQL contracts in the unit suite do not substitute for
hosted integration. The local PR-gate aggregator exits 1 without the six
required CI outcomes/summaries; missing evidence is not fabricated.

Final local results (log prefixes are `/workspace/cli-logs/aiso-studio-stage-4.`):

| Check | Result | Log suffix |
| --- | --- | --- |
| `npm run lint` | Pass, 0 errors/warnings | `lint.log` |
| `npm run typecheck` | Pass | `typecheck.log` |
| `CI=1 npm run test:unit -- --maxWorkers=2` | 532 files / 7,113 tests pass | `unit-final.log` |
| `npm run build` | Pass, Next.js 16.3.8 Turbopack | `build.log` |
| Existing component fixture preparation | 26 files / 161 tests pass | `fixtures.log` |
| Studio Playwright, Chromium + mobile, one worker | 52/52 pass, en + zh-HK | `e2e.log` |
| Capture/accessibility matrix | 24 Studio screenshots; zero axe violations open/closed; focus/text/targets/reflow pass | `visual.log` |
| Dashboard home isolation | Four en/zh-HK light/dark cases pixel-identical; no token leak | `visual.log` |
| `npm run audit:text` | Clean, no allowlist changes | `text-audit.log` |
| Hosted integration | Blocked / not run: provisions Neon branch and runs migrations | `integration.log` |
| Local PR-gate aggregator | Exit 1: six required CI outcomes/summaries absent | `pr-gate.log` |
| Config / dependency constraints | Exact single Vercel addition; dependency manifests unchanged; diff whitespace clean | `constraints.log` |

## NO_GOs and delivery hold

**Stage 6 NO; Production FEATURE OFF.** No Stage 5 Layout B full-bleed shell,
Studio sidebar or secondary `/studio/*` routes. No Stage 6 backend/spend,
new model calls, GSC live query, DataForSEO/Firecrawl vendor calls or connect
buttons, HK Mentions score, estimated rankings/market numbers, concept mock
product data, thread persistence, work-item save, database changes/migrations,
new durable quota, real document attachment, or environment writes of any kind.
Preview LIVE environment stays separate and untouched.

Draft PR only: no merge, ready-for-review action, review request, message to
anyone or PR-diff/Codex review. After draft PR + tip SHA: **STOP; HOLD until
CI green and AISO re-briefs**. Read-only CI status may be checked briefly;
this work does not wait for green or start Stage 5.
