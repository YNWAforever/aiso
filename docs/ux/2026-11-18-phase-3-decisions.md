# Phase 3: the open decisions, settled

Date: 2026-11-19. Follows `2026-11-18-phase-2-review.md` (PR #305). Branch
`claude/studio-ux-phase-3`. The owner asked for these to be settled "with judgement". Each
item below records the decision, why it was taken, and how to reverse it.

## Decisions

| # | Open item (Phase 2) | Decision | Why | Commit |
| --- | --- | --- | --- | --- |
| 1 | Basic/trial first task "Confirm questions" opened `/prompts`, which needs `edit_prompts` (Pro+) | When the plan cannot edit questions, the task reads **"See plans to confirm monitoring questions (Pro)"** and opens `/{lang}/pricing`. Plans that can edit questions are unchanged. | The code has no Basic route to confirm seeded questions. Widening the plan is a pricing decision, so it was not taken here. An honest label plus the upgrade path replaces a dead end. | `fix(today): first task never opens a locked page…` |
| 2a | Archived discussions could not be restored after the Undo notice was gone | **Archived discussions** section on the Discussions page. It is read only when opened (`GET …/studio/threads?archived=1`), lists only the viewer's own archived discussions, and has a Restore button per row. | The update API already accepted `archived:false`, and only a discussion's creator can change it, so the list shows exactly what the viewer can restore. A teammate's shared discussion that was archived never appears. | `feat(studio): restore archived discussions…` |
| 2b | Archived discussions count towards the 200-discussion limit; there is no delete | **Kept.** The copy now says so where it matters: the Archived section help text and the limit message. | Deleting a discussion is a schema and retention decision (turn receipts, MCP audit rows, branch lineage FKs). It is not a UI fix. | same |
| 3 | zh-HK Studio copy mixed colloquial Cantonese (~57 strings) with written Chinese (~150) | **Written Chinese (書面語) throughout Studio and Today.** 68 strings rewritten. Meaning is unchanged and no keys were added or removed. | It is the majority register, it matches pricing, settings and legal copy, and it reads correctly for an agency audience. Other namespaces (`pulseView`, `observations`, `changeSets`, `runProgress`, …, ~80 strings) still use colloquial Cantonese. Converting them is the follow-up. | `fix(i18n): one written-Chinese voice…` |
| 4 | Locale chip "Hong Kong · Traditional Chinese" in the English UI read as the answer language | **"Hong Kong market" / 「香港市場」.** | The chip describes the market Studio researches, not the language of the reply. | `fix(studio): label the locale chip…` |

## Root cause found: the intermittent axe contrast failure

Phase 2 recorded one unexplained failure in `conversation-studio` "IME, accessibility and
reflow": dark ink on a dark background. On this branch it became reproducible (0/4 for en on
chromium), which made it possible to trace.

`app/globals.css`'s reduced-motion rule set `transition-duration: 0.01ms` on every element.
`transition-property` defaults to `all`, so that rule turned every style change, including a
theme switch, into a transition. For one frame, computed colours kept their old values, and
axe could read the light ink (#17263e) over the new dark background. The rule now sets
`transition-property: none`. Nothing in the app listens for `transitionend` or
`animationend`. After the fix: 32/32 across 8 repeats.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run test:unit` | 9,648 passed. 2 failed only because the clone is shallow (the migration-contract tests diff against an old commit; they pass in CI). |
| `threads-sql` (archived list scoping: owner sees own, teammate sees none, other account 404) | 24/24 |
| Playwright, fresh build + regenerated fixtures, chromium + mobile: `conversation-studio`, `studio-shell` (incl. new restore test, en + zh-HK), `studio-continuous-chat`, `studio-reply-scroll`, `studio-action-outcomes`, `app-shell`, `c8a-workspace-home`, `c8b-portfolio`, `c8g-settings`, `sme-activation-today` | **456/456 passed** |

## Needs a human smoke test (Vercel preview, signed in)

1. Basic or trial account, new brand: Today's first task says "See plans…" and opens Pricing.
   A Pro account still opens the question editor.
2. Archive a discussion, reload, then open Discussions → Archived discussions → Restore. The
   discussion is back in the list and in the sidebar's recent discussions.
3. As a second member: a teammate's shared discussion that was archived does **not** appear
   in your Archived section.
4. Read the zh-HK Studio home, a discussion, the action confirmations and Today for tone.
5. With the OS set to reduce motion, switch theme. Colours change at once, with no flash.
