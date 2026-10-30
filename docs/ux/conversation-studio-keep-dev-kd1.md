# Conversation Studio keep-dev KD1 fidelity polish

DESIGN only, under the existing Stages 0–5 approval (Rio Ask `t130s893`).
Base: `4ea7943519100d6b71ee4829d5108dbc58b34234` (#125, Stage 5).
Branch: `codex/conversation-studio-keep-dev-kd1`.

Governing brief: supplied `KEEP_DEV_KD1_BRIEF.md`, identical to
`/workspace/aiso-brief-keep-dev-kd1-fidelity.md`. Product pack:
`_fleet_docs/superpowers/specs/2026-10-31-aiso-keep-dev-slices.md`.
The residuals are X8 and I5 in §3 of
`/workspace/aiso-studio-design-gap-and-plan.md`. Design references:
[TOKENS](conversation-studio-concept/TOKENS.md),
[VIEWS](conversation-studio-concept/VIEWS.md),
[STRINGS](conversation-studio-concept/STRINGS.md), the
[concept snapshot](conversation-studio-concept/concept-inner.html), and
[Stage 5](conversation-studio-design-stage-5.md), with Stages 1–4 as its baseline.
The user's handoff overrides the brief's push/PR step: commit locally, write PR
title/body files, and let the parent push and create the single **draft** PR.

## Residuals addressed

- **X8:** a pre-mounted `as-toast` status region announces successful
  “另開 brief 討論” in en and zh-HK, using `role="status"`,
  `aria-live="polite"` and `aria-atomic="true"`. Copy explicitly says the new
  discussion is temporary. Each new brief gets a fresh announcement node.
  Sending or navigating through the discussion controls clears the message;
  refresh clears the entire temporary session. The action still only prepares
  a separate editable draft and focuses the composer; it sends no request.
- **I5:** saved-result cards now offer same-brand opportunities, reports and
  existing-tools links, including ordinary questions and insufficient answers.
  Opportunities/reports come from `buildDashboardNav` in
  `lib/dashboard-nav.ts`; the tools link opens the existing `/studio/tools`
  catalogue, whose destinations use that same navigation model. The previous
  template-only opportunities/reports links move from the caveat into the
  result card. Links disable prefetch. No brand context means no outbound
  dashboard links. `MONITOR_VISIBLE=false` remains authoritative: no new direct
  Pulse/Monitor entry is advertised, and tool plan/admin gates remain intact.
- **Visual nit:** vertically center the breadcrumb's brand link, separator and
  current view. The link's existing 44px target had lowered its text relative
  to its siblings. The change is confined to `#aiso-studio .as-breadcrumb`.
  Toast typography/spacing uses the concept's scoped 12px blue feedback style.

The existing destination pages/services still authenticate and check account
ownership. Browser tests exercise both locales and two brands, visit both
external dashboard destinations, and follow tools → Scan. Each exit restores
the real `DashboardChrome`/sidebar and clears Studio memory on return. This is
offline presentation evidence; it does not establish hosted tenant access.
The unit suite covers the existing account/ownership/service boundaries.

## Visual comparison and accessibility matrix

Run locally with the real production components, memory provider and production
build CSS. Only Next navigation is replaced by the existing offline fixture
transport; synthetic owned records are labelled fixture evidence. Every
unexpected request is recorded and aborted. No Preview, hosted Auth, Neon,
vendor or model endpoint is used; existing explicit B2 sends are intercepted.

All six existing screens are captured in each row: **home, discussion, threads,
documents, connections, tools**. Viewports have height 1000px. Screenshots reset
the shell scroll position and mouse hover before capture. Long content still
scrolls within the full-bleed shell; these are viewport captures, not a claim
that all content fits above the fold.

| Locale | Width | Theme | Captures | axe violations | Reflow / ≥44px controls / ≥12px text |
| --- | ---: | --- | ---: | ---: | --- |
| en | 1440 | light | 6 | 0 | Pass |
| en | 1440 | dark | 6 | 0 | Pass |
| en | 900 | light | 6 | 0 | Pass |
| en | 900 | dark | 6 | 0 | Pass |
| en | 390 | light | 6 | 0 | Pass |
| en | 390 | dark | 6 | 0 | Pass |
| zh-HK | 1440 | light | 6 | 0 | Pass |
| zh-HK | 1440 | dark | 6 | 0 | Pass |
| zh-HK | 900 | light | 6 | 0 | Pass |
| zh-HK | 900 | dark | 6 | 0 | Pass |
| zh-HK | 390 | light | 6 | 0 | Pass |
| zh-HK | 390 | dark | 6 | 0 | Pass |

That is 72 Chromium screenshots; the same matrix also runs in the mobile
project. Zero violations includes zero serious/critical violations. Additional
checks cover the visible success toast, inspector focus/closing, IME, live-cap
zero, missing ≠ zero, B2 request shape and per-thread draft/reload isolation.

Local evidence for the parent handoff:

- `/workspace/cli-logs/aiso-kd1-shots/{locale}-{theme}-{width}-{view}.png`
- `/workspace/cli-logs/aiso-kd1-shots/checks.json`
- `/workspace/cli-logs/aiso-kd1-comparison.html` (concept beside every capture)
- `/workspace/cli-logs/aiso-kd1.playwright-full.json`
- `/workspace/cli-logs/aiso-kd1-isolation-checks.json`

| Concept reference | Visual comparison |
| --- | --- |
| [01 home](conversation-studio-concept/screenshots/01-home.webp) | Hero/composer/source bar/filter/two-column task order and scoped colors retained; mobile is one column. |
| [02 discussion](conversation-studio-concept/screenshots/02-discussion.webp) | Indented question, answer label, research disclosure, result cards and follow-up retained; outbound actions wrap at 390px. |
| [03 threads](conversation-studio-concept/screenshots/03-threads.webp) | Heading, recent discussion hierarchy and arrows retained; temporary-memory disclosure remains explicit. |
| [04 connections](conversation-studio-concept/screenshots/04-connections.webp) | Brand-scoped service cards, separate connection/sync/completeness states and honest pending/disconnected copy retained. |

The references are desktop light browser screenshots, not six responsive/theme
baselines. Dark/mobile checks use the snapshot's token and breakpoint rules.
Visual inspection compares hierarchy, geometry, color and wrapping; no pixel
equality with the mock is claimed. Layout B remains full-bleed, product text
remains ≥12px, controls remain ≥44px, and real missing/temporary/unsupported
states replace the concept's mock bindings, saved outputs and results.
Documents/tools use the snapshot and VIEWS because the supplied screenshot set
has no corresponding image. No IA rewrite or new view is introduced.

Dashboard-home style isolation separately swaps base Studio CSS for final
Studio CSS against the same dashboard DOM and unchanged production global CSS.
It waits for the theme control to mount before capture. All 12 locale/theme/width
pairs retain identical computed styles and geometry, with zero unexpected
requests. Eleven pairs are pixel-identical; the remaining pair differs at 41
rounded-border pixels by at most 1/255 per color channel. Exact counts are in
`aiso-kd1-isolation-checks.json`. Global CSS and dashboard chrome implementation
are unchanged; navigation restoration is covered separately by the E2E tests.

## Verification

Logs are `/workspace/cli-logs/aiso-kd1.*.log`.

| Check | Result | Log suffix |
| --- | --- | --- |
| `npm run lint` | 0 errors/warnings | `lint-final.log` |
| `npm run typecheck` | Pass | `typecheck-final.log` |
| `npm run audit:text` | Clean | `text-audit.log` |
| `npm run build` | Next 16.3.8 Turbopack pass; all five Studio routes compile | `build-final.log` |
| Focused Studio/nav/ownership units | 14 files / 163 tests pass | `focused-unit.log` |
| `TZ=UTC CI=1 npm run test:unit -- --maxWorkers=2` | 535 files / 7,144 tests pass | `unit-utc.log` |
| Chromium + mobile focused Studio E2E | 92/92 pass, no skips | `e2e.log` |
| Final screenshot framing + toast axe checks | 28/28 pass, no skips | `e2e-framing-toast.log` |
| Dashboard-home style isolation | 12/12 identical computed styles and geometry | `isolation-compare.log` |
| Hosted Neon/Auth/integration | N/A: real Neon provisioning, migrations and hosted journeys are outside this DESIGN authorization | Not run |

The first full unit run in the host's Hong Kong timezone had **7,143 passes and
one failure** in the unchanged `__tests__/enterprise/store.test.ts` legacy
competitor-report case. It derives the report date in UTC while PGlite defaults
to `Etc/GMT-8`, so the current observation lies in a different SQL calendar day.
The same failure reproduces from a clean archive of the exact base SHA
(`base-enterprise.log`); that base test passes under `TZ=UTC`
(`base-enterprise-utc.log`). The full final UTC run is green. No enterprise test
or product code is changed to mask this pre-existing timezone issue. `TZ` and
fixture variables are process-only test settings; no environment configuration
or env file is written. CI green is not claimed locally.

## NO_GOs and Stage 6 deferrals

**Stage 6a–6h NO; Production FEATURE OFF remains untouched.** No Preview or
Production environment writes, local env-file writes, Neon connection or
persistence, schema/migrations, work-item save/write, source attachment into
prompts, GSC/DFS/Firecrawl live query/connect, new model/vendor calls or spend,
Layout A, merge, push or PR creation. No feature flags, B1/B2 transport, quota
defaults, data semantics, inspector reads or ownership checks are changed.

Stage 6 source attachment (6a), work-item draft save (6b), persistent discussions
(6c), real opportunity analysis/read-through (6h), and the remaining 6d–6g work
stay deferred for separate approval. No Stage 6 capability is enabled by these
navigation links. `vercel.json` adds only this branch's deploy-disable entry and
preserves every pre-existing entry and setting.

Handoff files: `/workspace/cli-logs/aiso-kd1.pr-title.txt` and
`/workspace/cli-logs/aiso-kd1.pr-body.md`. Parent performs push and draft PR
creation. **Hold Extra High PR-diff review until CI is green and AISO re-briefs;
do not merge.**
