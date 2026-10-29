# Conversation Studio design — Stage 1

Willy continuous Stages **0–5 Approve**, via Rio Ask **t130s893**, 2026-10-29
HKT. Base: `af71a2be2235e3554084875d54a06fbbc59392a0` (Stage 0, #120).
This delivery is **Stage 1 DESIGN only**: visual chrome in the existing
`/studio` page. IA remains one-page; this is chrome fidelity, not the later
home/discussion composition or Stage 5 Layout B shell.

## Implementation

- `components/dashboard/conversation-studio.css` defines all 11 concept
  `--as-*` tokens on `#aiso-studio`, with `.dark #aiso-studio` overrides.
  Light background/card/primary/on-primary alias the existing semantic tokens;
  other colors and all dark values follow [TOKENS](conversation-studio-concept/TOKENS.md).
  Every selector requires the Studio root. Global theme, fonts and dashboard
  shell are unchanged.
- The header shows the real brand/title breadcrumb and localized Hong Kong /
  Traditional Chinese pill. Stage B1/B2 badges are no longer rendered.
  The amber “Evidence scope and limits” disclosure retains the saved/live
  transport notice, unverified-output warning and process-local cap disclosure.
  Per-send quota/disabled/plan states remain next to the platform controls.
- Existing composer, four templates, thread list and saved/live replies use
  concept type sizes, card geometry, badges and amber notes. Template labels
  and prompts are unchanged; new descriptions/outcome lines accurately describe
  saved-record extraction. Saved and live results stay separate. Coverage,
  provenance, search-execution uncertainty and missing-is-not-zero copy remain
  reachable in the existing evidence details.
- Body: 14px/1.6; h1: 30px/650, −0.8px tracking (26px on mobile); h2: 19px;
  h3: 15px. **Concept 11px eyebrows, labels and badges are raised to 12px**
  for the repository minimum. The Chinese eyebrow is localized as 「品牌工作室」
  with natural tracking. The answer kicker uses the repository's required
  “Fimmick AISO” product name. No CJK webfont is added.
- Composer: 16px radius, 15px padding, exact `0 6px 22px #102a5b06` shadow;
  templates: 11px radius/15px padding/10px gap and blue/soft hover;
  results: 10px; badges: 6px; notes/buttons: 8px. Visible buttons, links,
  checkbox labels and disclosure targets are at least 44×44px; keyboard focus
  has a 3px blue outline and 3px offset.
- `vercel.json` adds only
  `codex/conversation-studio-design-stage-1: false`, preserving existing entries.

The state and submit logic, B1 `composeSavedReply`, B2 POST, flags, cap logic,
evidence loader, routes, DB and environment files are unchanged. All work ran
locally in the Codex CLI at Extra High, without delegated agents or cloud tasks.

## Local verification

Evidence is retained under `/workspace/cli-logs/aiso-studio-stage-1.*.log`.
Browser preparation uses the existing
`scripts/ci/prepare-component-fixtures.mjs` and production build CSS. Studio
Playwright runs use `CI=1 E2E_FIXTURE_MODE=1`, Chromium/mobile, one worker;
unit runs use `CI=1`, two workers. Fixture variables are process-local only.

The screenshot matrix is in
`/workspace/cli-logs/aiso-studio-stage-1-shots/`:

- `studio-{en,zh-HK}-{light,dark}-{1440,900,390}-{idle,reply}.png`
- `dashboard-{en,zh-HK}-{light,dark}-1440.png`
- `checks.json`: per-case accessibility, reflow, text/target and isolation results.

The captures use actual production components with synthetic saved evidence
and intercepted live responses. They are **fixture evidence, not real service
acceptance**, authenticated-route acceptance or proof of provider availability.
The capture script is retained at
`/workspace/cli-logs/aiso-studio-stage-1.capture.cjs`. Its dashboard check renders
the existing home fixture with and without the retained Studio stylesheet and
compares screenshot hashes. Concept references remain
[01-home.webp](conversation-studio-concept/screenshots/01-home.webp) and
[02-discussion.webp](conversation-studio-concept/screenshots/02-discussion.webp).
The current composer/template/thread order is intentionally retained.

The initial unit run caught copy-audit violations in the new eyebrow/answer
label; those were corrected without relaxing the audit. An overlapping rebuild
removed the browser fixture files during the first E2E run (29 passed, three
ENOENT failures). The final build, fixture preparation and E2E run are sequenced
to avoid that conflict. Initial and final logs are retained. Final local results
and exact command/log references are recorded in the draft PR.

**Integration is blocked, not passed.** `npm run test:integration` uses
`__tests__/integration/setup.ts` → `createTestBranch()` in
`__tests__/helpers/neon-branch.ts`: it requires authenticated `neonctl`, creates
a real Neon branch, verifies identity, resets schema and applies migrations.
The Stage 1 no-Neon/vendor/spend restriction prevents running that harness.
No remote branch or service was used. The local PR-gate aggregator exits 1
because the six required CI class results/summaries are absent; a local full
gate pass is not claimed.

## Holds

No Stages 2–6 UI/backend, new views/routes/sidebar, home/discussion split, IA
restructure, Layout B shell, persistence, attachments, work-item saves, vendor
calls or spend. **Stage 6 NO; Production FEATURE OFF**. No Production feature
enable, Preview environment writes, merge or ready-for-review action.
Draft PR + tip SHA → STOP; HOLD PR-diff review until CI green and a new AISO
brief. The continuous plan does not start Stage 2 in this delivery.
