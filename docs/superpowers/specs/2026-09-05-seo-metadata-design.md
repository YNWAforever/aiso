# Per-page SEO metadata — design

**Status:** Approved 2026-09-05
**Covers:** item 2.4 of `docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`
**Sub-project B of Phase 2.** Sub-project A (the public shell) merged as #13.

## The defect

`lib/seo.ts`'s `buildLocalizedMetadata` hardcodes one title and one description for the whole site:

```ts
const title = isZh ? 'Fimmick AISO｜AI 搜尋能見度掃描' : 'Fimmick AISO | AI Visibility Scan'
```

Only `canonical` varies by path. Home and pricing already share a title, and the seventeen pages
Phase 2 adds would inherit the same one — twenty-nine pages with identical titles and descriptions,
on a product whose subject is AI search visibility.

There is a second, quieter defect. `app/sitemap.ts` keeps **its own** route list:

```ts
const LOCALES = ['en', 'zh-HK'] as const
const PUBLIC_ROUTES = ['', 'pricing'] as const
```

That is a third source of truth alongside `lib/navigation.ts` (29 routes, since #13) and
`i18n/routing` (locales). A page missing from the sitemap is invisible to exactly the crawlers this
product exists to optimise for, and nothing currently notices.

## Architecture

### Metadata resolves from messages

`buildLocalizedMetadata(locale, path)` looks up `seo.<key>.title` and `seo.<key>.description`, where
`<key>` derives from `path` — `'pricing'` → `seo.pricing`, and the empty path (the locale root) →
`seo.home`.

**No call site changes.** `app/[lang]/(marketing)/pricing/layout.tsx` already passes `'pricing'`;
`app/[lang]/layout.tsx` already passes nothing. The wiring is correct; only the source of the strings
moves.

`alternates.canonical`, `alternates.languages`, `openGraph` and `twitter` are untouched. They are
already right, and a slice that changed them alongside this would make both harder to review.

Copy lives in `messages/*.json` because that is where translators already work, and because it is the
only location that gets a both-locale parity guard for free.

### The sitemap derives from the nav config

`app/sitemap.ts` drops its two constants and reads `lib/navigation.ts` and `i18n/routing`, emitting
**only `available` routes** across both locales.

A sitemap advertising 404s is worse than an incomplete one, so `available` is the filter. The
consequence worth having: a page becomes crawlable the moment its slice flips `available: true`,
with no second edit for anyone to forget.

## Three guards

Each is the shape already proven by the nav config in #13.

| guard | what it stops |
|---|---|
| every `available` route has `seo.<key>.title` and `.description` in `en` | a page shipping with the site-wide default silently attached |
| the same keys exist in `zh-HK` | a raw key rendering to half the audience, which no English-speaking reviewer would notice |
| the sitemap's URL set equals `available` × locales | the two lists drifting apart again |

Unavailable routes need no copy. The guards track `available`, exactly as the nav route-existence
test does, so declaring the remaining 27 routes costs nothing until each is built.

## Error handling

A missing key is a **build-time test failure**, not a runtime fallback.

This is the whole point. The current behaviour *is* a fallback — every page silently inherits the
site default — and that silence is the defect. Replacing one silent default with another would leave
the same failure mode with more indirection.

## Testing

All unit, no network:

- per-path resolution returns **distinct** titles for home and pricing
- a missing `en` key fails, naming the key
- a missing `zh-HK` key fails, naming the key
- the sitemap's URL set equals `NAV.filter(available)` × locales
- `canonical` and `hreflang` still agree with `localizedUrl` — a regression guard, since this slice
  edits the function that produces them

`__tests__/seo/route-wiring.test.ts` already asserts home and pricing metadata wiring. It should now
also assert the two **differ**, which is the defect stated as a test.

## Out of scope

- `openGraph` images and JSON-LD beyond the existing `buildSoftwareApplicationJsonLd`
- `app/robots.ts` — correct as it stands
- Copy for the 27 unbuilt routes. Each page's slice writes its own title and description; inventing
  them now would mean guessing at pages nobody has designed.

## Risk, and the part that is not mechanical

The zh-HK titles and descriptions are **genuine translation work** — two strings per page, and they
are the text searchers actually see in results. Producing them by pasting the English is worse than
leaving a flagged gap, because a silent English string in the Chinese file will never surface again.

For the two existing pages this is four strings. Any the implementer is unsure of should be reported,
not guessed.
