# Public shell — design

**Status:** Approved 2026-09-05
**Covers:** items 2.2 and 2.3 of `docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`
**Sub-project A of Phase 2.** Phase 2 is ~14 slices; this is the dependency root.

## Why this first

`app/[lang]/page.tsx` and `app/[lang]/pricing/page.tsx` each carry their **own** inline `<nav>` and
`<footer>`. That duplication is not theoretical: home renders its sticky nav as `bg-background/95`
while pricing had a hardcoded `bg-white/90`, so the pricing page rendered white-on-near-black in dark
mode until 2026-09-05. Two copies of the same chrome drifted, and only one was fixed by the palette
work.

There are currently **zero** nav or layout components in the repository, and Phase 2 adds roughly
seventeen more pages. Every one renders inside this shell, so it is the true dependency root — and
the point at which the design system either becomes coherent or does not.

## Architecture

A **route group**: `app/[lang]/(marketing)/`. Route groups do not appear in URLs, so `/en/pricing`
stays `/en/pricing`. Membership is explicit — a page is in the shell because it sits in that folder —
and `dashboard`, `auth`, `onboarding`, `admin`, `r/` and `result/[id]` are excluded **by
construction** rather than by opting out. The alternative, extending `app/[lang]/layout.tsx`, inverts
the default: every new route would inherit marketing chrome unless it remembered to suppress it.

| file | responsibility |
|---|---|
| `app/[lang]/(marketing)/layout.tsx` | the shell: landmarks, header, `<main>`, footer |
| `lib/navigation.ts` | the information architecture, as typed data |
| `components/marketing/SiteHeader.tsx` | nav, dropdowns, locale switcher |
| `components/marketing/SiteFooter.tsx` | footer |

Home and pricing move into the group and lose their inline chrome.

**`app/[lang]/pricing/layout.tsx` must move with the page, not be dropped.** It exists solely to
supply `generateMetadata` with the `pricing` key — its component is a pass-through `<>{children}</>`
— so deleting it silently loses that route's metadata. It becomes
`app/[lang]/(marketing)/pricing/layout.tsx`.

`app/[lang]/layout.tsx` already provides `NextIntlClientProvider` and `setRequestLocale`. The
marketing layout nests inside it, so the header and footer get translations without new plumbing.

## The nav config, and the guard that keeps it honest

`lib/navigation.ts` holds the whole IA as typed data — section, **label key** (never a literal
string), href, and an `available` flag. Only available entries render.

The obvious failure is drift: a flag flipped on before its page exists, shipping a link that 404s in
the site header. So a test asserts **every available href resolves to a real route** under
`app/[lang]/`. That makes the flag self-policing rather than a promise someone has to keep.

A second test asserts every label key exists in **both** `messages/en.json` and `messages/zh-HK.json`.
A key missing from zh-HK renders as the raw key — which half the audience would see and no
English-speaking reviewer would notice.

Declaring the full IA now, rather than adding entries slice by slice, is deliberate. The dropdown
structure that nine platform pages must fit is decided once, cheaply, before fourteen pages depend on
the header's shape.

## This slice should burn down most of the remaining accessibility backlog

The baseline stands at **288** violating nodes:

| rule | count |
|---|---|
| `region` | 160 |
| `page-has-heading-one` | 48 |
| `landmark-one-main` | 32 |
| `color-contrast` | 48 |

`region` and `landmark-one-main` together are **192 of 288**, and both describe exactly what a
missing shell causes: content sitting outside any landmark, and no `<main>`. A layout emitting
`<header>`, `<nav>`, `<main>` and `<footer>` correctly should clear most of them across all eighty
cells at once.

**If those counts do not fall, the landmarks are wrong** — that is the finding, not an inconvenience,
and the baseline must not be regenerated to paper over it.

This is also the first use of the opt-in baseline update mode added in PR #10 for something other
than the change that motivated it.

## The locale switcher

In scope, because the site is bilingual and a visitor on `/zh-HK/pricing` currently has no way to
reach `/en/pricing` except by editing the URL.

One requirement that is easy to get wrong: switching locale must **preserve the current path**, not
return to the home page. `/zh-HK/pricing` → `/en/pricing`, not `/en`. A switcher that silently drops
the reader back to the root is worse than none, because it loses their place without telling them.

It renders both locales as links rather than a select, so the alternate URL is a real href — which
also means it is crawlable, and consistent with the `hreflang` alternates `lib/seo.ts` already emits.

## Primitives audit (2.2)

`components/ui/` holds **six** primitives. The audit is scoped to what the shell needs — realistically
a navigation-menu or dropdown primitive, since nine platform pages will need grouping.

Anything else it turns up is **recorded, not built**. A primitives backlog is an input to later Phase
2 slices; building primitives nothing yet renders is how a design system accumulates dead code.

## Error handling

The shell is presentational and the nav config is static, so there is no runtime failure mode beyond
config drift — which the route-existence test converts into a build-time failure.

## Testing

- Only `available` entries render; unavailable ones appear nowhere in the DOM
- Every `available` href resolves to a real route under `app/[lang]/`
- Every label key exists in both `messages/en.json` and `messages/zh-HK.json`
- Accessibility: regenerate the baseline and **report `region` and `landmark-one-main` before and
  after**
- Computed-style check that home and pricing now render identical chrome — the specific defect that
  motivated this slice
- `npm run lint` · `npm run typecheck` · `npm run build` · `npm run test:unit` clean

## Out of scope

- **A theme toggle.** `app/layout.tsx:21` reads `localStorage.theme`, so one was plainly intended,
  but none exists and the theme currently follows the system. Building it is a new feature, not shell
  extraction. Recorded, not built.
- **The seventeen pages themselves.** They join the group in later slices; the config declares them
  `available: false` until then.
- **Primitives the shell does not need**, per the audit rule above.
- **`result/[id]`, `r/[slug]`, auth, onboarding, dashboard and admin chrome.** Excluded by
  construction; changing any of them is a separate decision.

## Risk

Moving two pages between directories makes the diff look far larger than the change is. The mitigation
is that the move and the extraction are **separate commits**: first relocate with no content change,
then remove the inline chrome. A reviewer can then read the second diff on its own.
