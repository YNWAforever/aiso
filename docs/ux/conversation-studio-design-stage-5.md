# Conversation Studio design — Stage 5

Willy continuous **Stages 0–5 Approve**, via Rio Ask **t130s893**, selects
**Layout B full-bleed**. Base: `7d9f163150f48559dae7404d53d0d6f19cd8c53a`
(Stage 4, #124 squash merge). This delivery is **Stage 5 DESIGN + READ**.
The authoritative brief is `/workspace/aiso-brief-studio-design-stage-5.md`;
design references are [TOKENS](conversation-studio-concept/TOKENS.md),
[VIEWS](conversation-studio-concept/VIEWS.md),
[STRINGS](conversation-studio-concept/STRINGS.md) and the concept screenshots.
Stages [1](conversation-studio-design-stage-1.md),
[2](conversation-studio-design-stage-2.md),
[3](conversation-studio-design-stage-3.md) and
[4](conversation-studio-design-stage-4.md) remain the behavior baseline.

## Implementation plan

The supplied branch and workdir are the authorized isolated workspace. Layout B
and continuous implementation are already approved; no new design approval is
needed. Use the existing Next.js 16 / React / next-intl / scoped Studio CSS.

- [x] Add regression tests for route-scoped chrome, ownership gates, read-only
  projections and tool visibility, and observe failures before implementing.
- [x] Add `DashboardChrome` to select full-bleed Studio by exact route segments;
  preserve the ordinary sidebar, trial banner and TopBar everywhere else.
- [x] Add a guarded Studio layout, Studio sidebar/header and brand-keyed
  `StudioSessionProvider`. Move existing temporary thread/draft state into this
  in-memory provider. Keep B1/B2 composition and transport unchanged. Reset on
  refresh, leaving Studio or changing brand/account; never use browser storage.
- [x] Add threads, documents, connections and tools pages. Each page independently
  checks authentication, flag, valid brand ID and account ownership. Sources and
  work items use existing authenticated READ services; GSC reads saved state.
  Project metadata only. Failed reads stay pending, distinct from empty results.
- [x] Translate both catalogs; extend only scoped CSS. Preserve hidden Monitor,
  plan locks and admin authorization. Retain dashboard escape paths and ⌘K.
- [x] Add browser fixtures using production shell/pages, then test navigation,
  session isolation, all secondary views, mobile menu at ≤620, keyboard/focus,
  no vendor requests, dashboard isolation, light/dark and en/zh-HK accessibility.
- [x] Add exactly one Vercel deploy-disable entry; run lint, typecheck, unit,
  build, fixture and Studio browser checks sequentially where required. Record
  hosted integration/CI limitations honestly.

Delivery: push and open a **draft** PR; return the URL and pushed tip for approval.

Focus cases: prefix-like routes must retain dashboard chrome; stale async live
answers must stay in their original brand provider; failed readers cannot imply
empty data or disconnected services; hidden Monitor links stay hidden; mobile
navigation must close with Escape and restore focus.

## Implementation

The server dashboard layout retains authentication, session refresh, notification
and owned-brand reads. `DashboardChrome` selects Studio only for the localized
brand `/studio` route and descendants. Studio replaces the global rail, top bar
and trial banner with its own 205px rail (178px at ≤900), breadcrumb, locale
link and command palette. Other dashboard pages retain their original chrome.
At ≤620 the rail collapses into a labelled menu; Escape restores its toggle.
All new selectors/tokens remain under `#aiso-studio`; typography stays ≥12px
and interactive targets ≥44px. No CJK font or global theme change.

The Studio layout checks the feature flag and session account's brand ownership,
then reads the same account's brand list. The memory provider is keyed by
`account_id:clientId`. Threads, per-thread drafts, the new composer draft,
request lock and ID allocator live there. Navigating within Studio retains them;
refresh, brand/account change or leaving Studio clears them. No browser storage,
thread API or database persistence is added. Recents show up to four actual
temporary threads with explicit **暫存** labels. B1 composition, B2 transport,
the default-zero cap and Stage 4 inspector behavior are preserved.

Every secondary page independently calls the ownership guard. Documents use
`loadStudioDocuments` / the authenticated sources service for current approved,
non-revoked version metadata, and `listAuthenticatedDrafts` for existing work-item
metadata. Contents, notes and evidence snapshots never cross the client boundary
or enter a prompt. Bounded lists disclose truncation and link to existing source,
task and version/review flows. Failed reads remain pending; confirmed empty lists
say “Not recorded”. There are no mutation controls.

Connections reads only saved GSC binding/ledger state under the existing feature
and plan gates, using the session account. Binding, sync, saved data-through date
and completeness remain separate. Unknown access/read failures are pending.
“View connection scope” links to the actual existing panel on `/assets`.
DataForSEO says **香港端點待核實 / 未連接**; Firecrawl says **未連接**.
Neither has a connect button, vendor client or outgoing request.

Tools maps the concept's 16 destinations through `lib/dashboard-nav.ts` with
the existing visibility rules: **MONITOR_VISIBLE=false** hides its five entries,
leaving 10 tiles for ordinary users and 11 for admins. The explicit concept
Local Trust/ROI route remains `?step=roi`; admin remains `/admin?lang=…` with its
existing server gate. Plan locks remain visible. Tool links restore dashboard
chrome. Brand switching, Studio and dashboard destinations, and new discussion
actions are available in the command palette.

Both catalogs follow STRINGS, with honest temporary-memory and connector copy
instead of mock sharing/bindings. Exact brand-lockup/tools names have scoped
text-audit exceptions; regression tests reject other keys or changed wording.
`vercel.json` adds only this branch's deploy-disable entry and preserves all
existing configuration. Dependencies, proxy, model configuration and flags are
unchanged. Work runs locally in the supplied Codex CLI; no delegated agents or
CloudAgent are used.

## Verification boundaries

Logs use `/workspace/cli-logs/aiso-stage5-draft.*.log`. Browser tests render actual
production shell, session and page components in offline fixtures with a Next
navigation shim and synthetic owned records. Existing B2 acceptance intercepts
the explicit-send transport. These checks do not prove hosted Auth, provider
availability or a real tenant database. No production route bypass is added.

Hosted integration is **blocked / not run**: `__tests__/integration/setup.ts`
calls `createTestBranch`, resets schema and applies migrations on a real Neon
branch. This DESIGN + READ delivery does not authorize that workflow. Existing
in-memory PGlite SQL contracts run in the unit suite. The local PR-gate aggregator
returns 1 because all six required CI job outcomes/summaries are absent; CI green
is not claimed locally.

Initial checks caught missing fixture router support, named-slot traversal in
dashboard entitlement tests, a moved ref/type import, and the mobile header's
missing landmark / duplicate banner. The menu strip is now a navigation landmark. Those were corrected without relaxing access or accessibility
assertions. Initial failure logs are retained. Disposable Playwright report/trace
assets are removed before final lint to avoid linting generated vendor JavaScript.

Local evidence:

| Check | Result | Log suffix |
| --- | --- | --- |
| `npm run lint` | 0 errors/warnings | `lint-verified.log` |
| `npm run typecheck` | Pass | `typecheck-verified.log` |
| `CI=1 npm run test:unit -- --maxWorkers=2` | 535 files / 7,142 tests pass | `unit-verified.log` |
| Final focused ownership/shell tests | 3 files / 28 tests pass | `final-focused.log` |
| `npm run build` | Next.js 16.3.8 Turbopack pass; all five Studio routes compiled | `build-final.log` |
| Component fixtures | 27 files / 163 tests pass | `fixtures-final.log` |
| Full Studio browser suite, Chromium + mobile, one worker | 88/88 pass, no skips | `e2e-final.log` |
| Mobile matrix after final title/header spacing refinement | 4/4 pass across six screens, en/zh-HK light/dark | `mobile-final.log` |
| Dashboard home style isolation | Four en/zh-HK light/dark cases pixel-identical | `isolation-final.log` |
| `npm run audit:text` | Clean | `text-audit-final.log` |
| Hosted integration | Blocked / not run: real Neon provisioning/migrations | `integration.log` |
| Local PR-gate aggregator | Exit 1: six CI outcomes/summaries absent | `pr-gate.log` |

Screenshots: `/workspace/cli-logs/aiso-stage5-draft-shots/`, 72 captures across
en/zh-HK × light/dark × 1440/900/390 × home/discussion/threads/documents/
connections/tools. `checks.json` records the matrix. The tests require **zero
axe violations**, no horizontal overflow, ≥12px text, ≥44px controls and zero
unexpected requests. Desktop and mobile examples were visually inspected.
Four dashboard captures and pixel hashes are retained separately under
`aiso-stage5-draft-isolation-shots/`.

## NO_GOs and delivery hold

**Stage 6 NO; Production FEATURE OFF.** No Neon thread persistence, schema or
migrations, work-item writes/saves, attachments into prompts, GSC/DFS/Firecrawl
live queries/connect actions, opportunity writes, durable quota, new models or
spend. No local/Preview/Production environment writes, Layout A, merge,
ready-for-review action or CloudAgent. Existing live transport stays explicit-send
only with its unchanged default-zero cap. No new vendor calls in this work.

Draft PR + pushed tip → return for approval. **HOLD Extra High PR-diff review
until CI green and AISO re-briefs**; do not dispatch or perform that review here.
