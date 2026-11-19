# Phase 2 review — logged-in Studio and workspace

Date: 2026-11-18. Follows `2026-11-18-logged-in-ux-review.md` (PR #304) and
`2026-11-18-studio-logic-map.md` (Phase 1). Branch `claude/studio-ux-phase-2`.

**Method.** Production components rendered through `scripts/ci/prepare-component-fixtures.mjs`
on a fresh `next build`, with every outbound request aborted. Screenshot matrix: Studio
(home, Discussions, Weekly, Documents, Connections, Tools, copilot IA), Today/WorkspaceHome
(C8A), app shell (AISO_SHELL), portfolio (C8B) and settings (C8G) at **1440 / 768 / 375 px ×
en / zh-HK × light / dark — 324 screenshots, 0 horizontal overflow, 0 render errors.** No
signed-in production session was available; everything below that depends on real data is
listed under *Needs a human smoke test*.

Severity: **H** user is stuck or misled about money/data · **M** confusing or extra effort ·
**L** polish.

## Findings

### Fixed in this branch

| # | Sev | Finding | Fix | Commit |
| --- | --- | --- | --- | --- |
| 1 | H | A failed "create discussion" poisoned the thread: every later send failed, composer stayed enabled | Definite 4xx refusals recorded with their reason; an unconfirmed create (no idempotency key) is still never retried but blocks further sends and offers *Start a new discussion* / *All discussions* | `fix(studio): give failed saves…` |
| 2 | H | One-brand account home (copilot IA) had no way to add a second brand | Add-brand control shown under the same capacity rule as the portfolio | `fix(ux): add-brand on one-brand home…` |
| 3 | M | Archive and member removal used `window.confirm`; archive could not be undone from any UI | Existing `ConfirmDialog` (Radix `alertdialog`, destructive, focus returns to the menu button); Undo notice on Chat home and Discussions (API already accepted `archived:false`) | `feat(ux): one accessible confirm pattern…` |
| 4 | M | Composer cleared on send; a failed message offered no resend, and the quota message claimed the draft was kept | Failed message goes back into the box; quota copy says what happened and when it resets | `fix(studio): give failed saves…` |
| 5 | M | Action skills showed definite refusals (scan limit 429, improve 404/400, external agent 409) as "may already have run" | Classified as refusals with the real reason; generation 409s that can follow a started model call stay unknown | same |
| 6 | M | "Private to you" on shared and teammates' threads | One status badge from visibility/ownership; footer lock follows it | same |
| 7 | M | Evidence panel: Search Console "Pending verification" when not offered; keyword/page reads "Not connected" when merely not queried | Hidden when not offered; "Not used for this answer" | same |
| 8 | M | "Save to Google Docs" on plans without platform access (403 → dead end) | Shown only when the plan has platform access | same + null-safe fix |
| 9 | M | Attachment stuck to every later message across discussions (silent token cost) | Cleared when opening another discussion or going home | same |
| 10 | M | Onboarding showed the API's internal English ("Claim unavailable", `ONBOARDING_INTENT_CONFLICT`) in both locales | Translated, actionable copy per failure class | `fix(ux): add-brand…` |
| 11 | M | Improve *Generate* looked like it did nothing on 409 external agent / 404 / not in plan | Reason shown | `fix(ux): load errors…` |
| 12 | M | Scan timeout / non-JSON 5xx reported as "Network error" | Reported as temporarily unavailable | same |
| 13 | M | Five load-error states with no next step (portfolio, Today, workspace home/monitor/steps) | One `states/LoadError` with *Try again* and *Back to your brands* | same |
| 14 | M | Raw plan id under the user name in the sidebar; "Free" untranslated; three ad-hoc capitalisations | `lib/format/plan-name.ts` + `planNames` messages (zh matches pricing) | `refactor(ux): one display-date…` |
| 15 | M | Postgres text timestamps ("…+00") fell through unparsed and showed raw; ~12 ad-hoc formatters | `lib/format/date.ts` (HK time, optional zone label), used by Studio and Overview; tests | same |
| 16 | M | Remaining jargon: answer units, token budget, provider attempts, agent use, Pacific dates, canonical Pulse week, binding/rebinding, weekly rollup, finish reason, "Pending verification" for load failures | Plain-language rewrites, en + zh-HK | `fix(studio): plain language…` |
| 17 | L | Raw record ids, model id, timing and finish reason inline in evidence | Kept for audit under *Technical details*; platform names and readable dates inline | same |
| 18 | L | zh-HK strings mixing 嘅 and 的 in one sentence | Three strings made consistently written | same |
| 19 | L | Members fell back to the internal profile id as a name | "Unnamed member" | `feat(ux): one accessible confirm…` |
| 20 | L | Staff view showed "AI replies are not switched on for this brand" | Hidden for staff | `fix(studio): give failed saves…` |

### Accessibility (WCAG 2.2 AA)

- The new dialogs are Radix `alertdialog`s: focus moves into the dialog and Escape closes it.
  Focus then returns to the menu button, because the menu item that opened the dialog has
  closed (`returnFocusRef`). This is asserted in `studio-shell.spec.ts`, along with an axe pass
  on the open dialog.
- The Undo notice is a polite live region. It doesn't steal focus.
- Every new control is ≥ 44 px (`min-h-11`). The existing 44 px Studio link rule is kept, by
  owner decision.
- The existing Studio, shell and workspace specs run axe in en and zh-HK, light and dark, at
  1440/900/390 px. They are part of the verification counts below.

### Deferred, with reasons

> The first five rows below (locked first task, archive limit, archived view, zh-HK register,
> `localeBadge`) were settled in Phase 3. See `2026-11-18-phase-3-decisions.md`.

| Item | Why deferred |
| --- | --- |
| **Basic/trial first task leads to a locked page** (`confirm_prompts` → `/prompts`, which needs `edit_prompts`) | Product decision on plan gating: the code shows no Basic route to confirm seeded questions. Needs the owner (open question 1). |
| 200-thread cap counts archived threads; no delete | Server/schema change; the limit is now *explained* instead. |
| Archived view with Restore | Needs a server list parameter; Undo covers the immediate case. |
| Full zh-HK register unification (~57 colloquial vs ~153 written strings in Studio) | Copy-wide voice decision; only mixed-in-one-sentence strings were fixed. |
| `localeBadge` "Hong Kong · Traditional Chinese" in the English UI | The code does not settle whether it describes the research market (always HK/Traditional) or the answer language. Left as is. |
| Trial status in Settings ("Basic · Active" during trial) | Billing presentation, out of scope. |
| Remaining ad-hoc date formatters (`RecentScans`, `ScanSummary`, `ImproveStep`, `ScanPicker`, `NotificationBell`, …) | Their outputs are pinned by existing tests; migrate one at a time onto `lib/format/date.ts`. |
| Mobile composer on-screen keyboard, sticky send, safe-area insets, inspector as bottom sheet | Needs a real device; fixture screenshots can't show keyboard behaviour. |
| Command palette completeness / keyboard shortcuts | Not regressed; no audit evidence of a gap beyond #304's fix. |
| Locked flag pages (`/visibility`, `/outcomes`, `/enterprise`) bare text | Rare (flags off in production). |
| Inspector beside the conversation between 900–1100 px with ≥ 2 threads | CSS order issue noted in Phase 1; low frequency. |

### Load-sensitive tests: root cause found and fixed

- **zh-HK/en timing assertions** (`conversation-studio` "composer shows remaining LIVE
  answers…", `studio-action-outcomes` "scan outcome stays exact…"). Both read a request
  counter synchronously right after a click. But the model request (sent only after the turn
  is saved) and the scan POST are asynchronous, so under parallel load the counter could
  still be 0. Both now use `expect.poll`, which passed 80/80 across 10 repeats (`7c6e54c`).
- **`conversation-studio` "IME, accessibility and reflow" (en, desktop).** In one run, axe
  reported `color-contrast` with dark ink on a dark background (#17263e on #0d1320), which
  looks like a snapshot taken mid-way through a theme transition. It did not reproduce in 128
  further runs. **Root cause found in Phase 3:** the reduced-motion rule turned every style
  change into a 0.01 ms transition (see `2026-11-18-phase-3-decisions.md`).

## Review follow-up (Codex on #305)

Two findings on the "failed message returns to the box" change, both confirmed and fixed in
`1eb6e82`:

- **Duplicate on resend.** After an unknown outcome, restoring the question let a resend
  mint a new `requestId` and save the message twice. Now only a definite refusal (4xx)
  restores it; an unknown outcome is read back and reconciled by `requestId`.
- **Lost skill.** The retried question lost its skill. Its skill is now restored with it.

New e2e coverage for both paths, in en and zh-HK on desktop and mobile.

## Verification (final code)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run test:unit` | 9,646 passed; 2 failed only because the clone is shallow (migration-contract tests diff against an old commit; they pass in CI) |
| Playwright, fresh build + regenerated fixtures, chromium + mobile: `conversation-studio`, `studio-shell`, `studio-continuous-chat`, `studio-reply-scroll`, `studio-action-outcomes`, `app-shell`, `c8a-workspace-home`, `c8b-portfolio`, `c8g-settings`, `sme-activation-today` | **443 passed, 5 failed**. 4 were two inspector assertions that still expected the raw ISO date and treated the last link as the last focusable control; both were updated in `2760270` and now pass 8/8. The fifth is the IME case above. |
| `conversation-studio` rerun after `2760270` | 108/108 |

## Needs a human smoke test (Vercel preview, signed in)

1. Archive a discussion → dialog → Archive → Undo brings it back; Escape returns focus.
2. Remove a member → dialog → member removed; restore works without a dialog.
3. Send a Studio message with the network throttled/offline → message returns to the box.
4. Run *Scan brand* from Chat after using up the plan's scans → refusal with reason, not
   "may already have run".
5. Plan without platform access: no *Save to Google Docs*; evidence panel shows no Search
   Console when not offered.
6. Attach a document, switch discussion → attachment cleared.
7. Account with one brand (copilot IA on) → *Add brand* visible; hidden at capacity.
8. Onboarding with a scan from another account → translated message.
9. Sidebar/top bar show the plan name (e.g. "Pro" / "專業版"), never the raw id.
10. zh-HK pass over Studio copy for tone.
