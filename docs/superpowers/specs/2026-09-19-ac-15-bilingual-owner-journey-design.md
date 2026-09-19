# AC-15: a bilingual owner-journey walkthrough

## What this closes

AC-15 asks whether English and Traditional Chinese are equivalent in meaning,
state and action. `message-catalogue-parity.test.ts` already proves the
*catalogue* has no missing, mismatched or byte-identical-by-accident keys
across all 1727 leaves — but that is a static proof over JSON files, not a
proof that a real page, navigated live against a real session, actually shows
the Chinese string when a Chinese-locale URL is requested. AC-14's work this
session built exactly the infrastructure (`authenticatedPage`, real captured
sessions, the `authenticated-mobile` Playwright project) needed to close that
gap for the owner journey specifically, which is the row's own named
remainder: "no bilingual walkthrough of the whole owner journey."

This is a small, targeted addition — one new test — not a new subsystem.

## Decisions taken

1. **One targeted walkthrough test, not full parameterization of all 5
   existing tests.** The catalogue-parity suite already exhaustively proves
   the translation data itself; what's missing is proof that *rendering*
   picks the right locale end-to-end, which one representative walkthrough
   establishes without roughly doubling this file's E2E runtime for
   marginal additional proof.
2. **Owner side only, not the approver's decision controls.** AC-15's own
   gap language says "the whole owner journey" — matching the file's
   original 3-test scope before the approver block existed. Extending into
   the decision flow would stretch one test across two identities and a
   larger surface than the row's own wording calls for.
3. **No new captured session.** Locale in this app is pure URL-path routing
   (`app/[lang]/`, `next-intl`, confirmed via `i18n/routing.ts`), resolved
   per-request from the URL segment — entirely independent of the
   authenticated session's cookies. The existing `owner-state.json` capture
   authenticates identically under `/zh-HK/` as under `/en/`.

## The test

Added to the existing `test.describe('the owner journey on a phone', ...)`
block in `tests/e2e/authenticated/owner-review.spec.ts`, alongside (not
replacing) the 3 existing tests:

**`'Home, approved facts and a submitted version render correctly in
Traditional Chinese'`**, using `authenticatedPage`. Walks the same three
screens the existing owner tests visit, against `/zh-HK/` routes, asserting
the specific rendered Chinese string at each step rather than "not empty" —
matching this session's established "specific, not decision-invariant" proof
style:

1. **Home** (`/zh-HK/dashboard`) — the priorities section (aria-labelledby
   `priorities-heading`) contains **"今日先做這三項"** (`priorities.title`,
   the zh-HK value for the English "Do these first").
2. **Approved facts** (`/zh-HK/dashboard/{clientId}/sources`) — the main
   region contains **"必須同時符合三項條件才會被引用"** (`sources.gate`'s
   zh-HK value) and **"這些是匯入，不是連線"** (`sources.notConnected`'s
   zh-HK value).
3. **A submitted version** — the same `openLatestSubmittedVersion`-style
   navigation the existing third test and both approver tests already use,
   confirming the "Immutable version details" region opens under the
   zh-HK path too (this region's own label already goes through
   `next-intl`, so reaching it live is the proof; no separate
   zh-HK-specific string assertion needed beyond confirming it renders).

**Deliberately not repeated in this test:**
- The touch-target sweep (`productButtons` + 40px check) — an
  accessibility property, not a language one, already proven once by the
  existing second test. Re-running it here would prove nothing AC-15 asks
  about.
- The approver's decision controls (approve / request-changes) — out of
  scope per Decision 2 above.

## Implementation note (for the plan, not a design decision)

`openFirstBrand` (`tests/e2e/authenticated/owner-review.spec.ts:39-49`)
currently hardcodes `waitForURL(/\/en\/dashboard\/[^/]+/)`, so it needs a
small parameterization — a `lang` parameter defaulting to `'en'` — so the
existing 3 tests' call sites need no changes while the new test can pass
`'zh-HK'`. This is a mechanical adjustment to an existing shared helper, not
a new abstraction.

## Testing / verification plan

Same discipline as the rest of this file: `npm run typecheck`, lint, and a
placeholder-file Playwright collection check (proving the new test is
discovered, expecting 6 total tests under `authenticated-mobile` — the
existing 5 plus this one) are all that can run in an environment without a
real captured session. The test's actual pass/fail against a live database
and session is a manual step, same as every other test in this file —
nothing here changes that established pattern, and the AC-15 row will be
updated once a human runs it for real, the same way AC-14's row was.
