# UI primitives audit

**Taken 2026-09-05**, while building the public shell (Phase 2 item 2.2).

**Nothing here is a work order.** It records what exists and what is missing so later Phase 2
slices can decide. Building primitives that nothing renders is how a design system accumulates
dead code, so the shell built none of them.

## What exists

`components/ui/` holds **six** primitives: `badge.tsx`, `button.tsx`, `card.tsx`, `input.tsx`,
`label.tsx`, `separator.tsx`.

They follow shadcn/ui conventions, and the directory is lowercase-named on purpose — `shadcn add`
writes there and breaks if the casing changes.

## What the shell used

**None of them.**

`SiteHeader.tsx` and `SiteFooter.tsx` import only `next/link`, `next-intl`, `next/navigation`,
`lucide-react` and `@/lib/navigation`. The chrome is native elements plus Tailwind utilities.

That is worth recording rather than glossing over: the first real consumer of the design system
needed nothing from it. Six is a small set, and the six present are form-and-surface pieces rather
than navigation pieces.

## The one substitution the shell made

The grouped-section disclosure for Platform / Solutions / Company uses a **native `<details>`**
rather than a dropdown primitive.

Deliberate: all three sections currently have zero available entries, so the machinery renders
nothing and is **built but unexercised**. A native `<details>` has no ARIA plumbing to get wrong
while it sits unused. The first slice to flip a `platform` entry to `available` is the first real
test of it, and that slice should decide whether to keep `<details>` or introduce a proper
navigation-menu primitive — with a keyboard and screen-reader pass either way.

## What is likely missing for the remaining ~17 pages

Inferred from the page types in `docs/contracts/routes.md`. **Unverified against real designs**,
because the designs do not exist yet — treat this as a prompt for each slice, not a shopping list.

| candidate | likely needed by |
|---|---|
| navigation-menu / dropdown | the header, once Platform and Solutions have entries |
| sheet / drawer | a mobile nav, which the current header does not have |
| accordion | FAQ sections on `/pricing`, `/how-it-works` |
| tabs | `/platform/*` capability pages |
| dialog | contact and demo request flows |
| table | comparison content on `/pricing` and `/solutions/*` |

## The gap that is not a primitive

The header has **no mobile navigation**. At narrow viewports it renders the same inline links.
That is less a missing primitive than a missing decision, and it should be made by the slice that
first has enough entries for it to matter — with the a11y matrix's 375px column as the check.

## One measured fact, recorded here because it redirects later work

The public shell was expected to clear most of the accessibility backlog. It cleared none:
`region` stayed at 160 and `landmark-one-main` at 32.

All 192 of those violations come from `/auth/login` and `/onboarding`, which have their own
layouts and sit outside the marketing shell entirely. Home and pricing carried zero. Any future
plan to "fix landmarks with a shell" should start there instead — see
`docs/superpowers/specs/2026-09-05-public-shell-design.md` for the measurement.
