# Check copy: editorial restraint and the `question` field — design

**Status:** Approved 2026-09-03
**Phase:** 2. Donor transplant, content rather than presentation.
**Scope:** The 20 checks' explanatory copy in both locales. No scoring change, no route change, no styling.

## Why this, and what it is not

The `aisogpt` donor repository (`YNWAforever/aisogpt`, pinned at `52cbcb4`) was believed missing from
this machine and was blocking all of Phase 2. It is not missing — it is a public GitHub repository,
and the pinned SHA resolves. An earlier survey checked local directories, git remotes and submodules,
and concluded "not found anywhere"; that conclusion was too narrow.

**A correction that reshaped this slice.** The survey reported `lib/checkExplanations.ts` as "334
lines, English-only", and the phase was originally chosen to make it bilingual. That is wrong. The
file already exports `CHECK_EXPLANATIONS` (en, lines 6–168) **and** `CHECK_EXPLANATIONS_ZH_HK`
(lines 169–331), with `getCheckExplanations(locale)` selecting between them. All 20 checks are
already translated, `why` and `fix.{pass,warn,fail}` alike. `messages/{en,zh-HK}.json` separately
carries a `checks` namespace of 91 keys — check titles plus 71 status messages — with zero keys
missing from either locale.

So there is no translation gap. What the donor actually offers is **editorial**: copy that declines
to assert outcomes the scan cannot observe. Its own header states the thesis — crawler access is
never presented as ranking, mention or citation.

## The principle

**Keep concrete, verifiable detail. Remove asserted outcomes the product cannot evidence.**

This is deliberately not "adopt the donor's text". The donor is frequently too terse and discards
genuinely useful specifics — it drops the crawler names from `c1_robots`, which are the most
actionable thing in that sentence. The target's copy is more helpful and less defensible; the
donor's is more defensible and less helpful. The rewrite takes the useful half of each.

Three categories to remove:

1. **Unevidenced causal claims.** "Blocking them means your content is invisible to every AI search
   engine." The scan observes a `robots.txt` policy. It does not observe indexing, retrieval or
   citation by any platform.
2. **Unevidenced quantitative comparisons.** "significantly more likely to be quoted verbatim" —
   no measurement in this product supports a magnitude.
3. **Emerging conventions stated as requirements.** `llms.txt` is a convention some tools read. It
   is not "the AI equivalent of sitemap.xml", and no ranking system requires it.

What stays: named crawlers, named formats, named fields, concrete actions. Those are checkable.

## Calibration: three rewrites, for approval before the other seventeen

These are real strings from `lib/checkExplanations.ts`, not illustrations.

### `c1_robots`

**Today (en):** AI crawlers like GPTBot, ClaudeBot and PerplexityBot check robots.txt before
fetching any page. Blocking them means your content is invisible to every AI search engine.

**Proposed (en):** AI crawlers like GPTBot, ClaudeBot and PerplexityBot read robots.txt before
fetching a page. Blocking rules there can prevent an allowed crawler from retrieving your content.

**Proposed (zh-HK):** GPTBot、ClaudeBot 與 PerplexityBot 等 AI 爬蟲在讀取頁面前會先查看
robots.txt。當中的封鎖規則可能令獲准的爬蟲無法讀取你的內容。

*What changed:* "invisible to every AI search engine" is an outcome across all platforms that
nothing here measures. "Can prevent an allowed crawler from retrieving your content" is the
mechanism the check actually inspects. The crawler names are kept — the donor drops them.

### `c2_llms_txt`

**Today (en):** llms.txt is the AI equivalent of sitemap.xml — it tells every AI platform what your
site covers, who you are, and which pages are most important to cite.

**Proposed (en):** llms.txt is an emerging content-map convention, not a ranking or citation
requirement. Where it is read, it describes what your site covers and which pages matter most.

**Proposed (zh-HK):** llms.txt 是新興的內容地圖慣例，並非排名或引用的必要條件。在有讀取的情況下，
它說明你的網站涵蓋什麼內容，以及哪些頁面最重要。

*What changed:* "the AI equivalent of sitemap.xml" and "tells **every** AI platform" both overstate
adoption. "Where it is read" is the honest qualifier. Note this check still carries its full weight
in scoring — the copy change does not touch `lib/scoring.ts`.

### `c17_citation_density`

**Today (en):** AI models weight content that cites authoritative external sources. Pages with
tier-1 citations (NIH, Bloomberg, Reuters) are significantly more likely to be quoted verbatim by
AI search engines than uncited claims.

**Proposed (en):** Citing authoritative external sources lets a reader — or a model — verify a
claim. Citation density supports verification; it does not by itself produce an AI citation.

**Proposed (zh-HK):** 引用權威外部來源，讓讀者或模型能夠核實論述。引用密度有助查證，
但本身並不代表會獲 AI 引用。

*What changed:* the strongest claim in the file. "significantly more likely to be quoted verbatim"
asserts a measured magnitude that does not exist. The donor's equivalent is blunt about it —
"density does not prove an AI citation" — and that is the substance worth keeping.

## Components

### 1. Rewrite `why` for all 20 checks, both locales

40 strings in `lib/checkExplanations.ts`. Each rewrite is judged against the three categories above;
a check whose current `why` makes no unevidenced claim is left alone and reported as unchanged.
Do not rewrite for style. The zh-HK rewrites follow the en ones and may take wording from the
donor's `why` array in `app/repo-scan-truth.ts`, which is already bilingual and keyed by the same
ids.

### 2. Add a `question` field, both locales

The donor carries a `question` per check — the plain-language thing the check is asking ("Are public
pages available to declared crawlers?"). The target has no equivalent, and it is the clearest
SME-facing framing in the donor. Source it from `repo-scan-truth.ts`, whose 20 ids match the
target's exactly, verified id-by-id with no gaps in either direction.

`CheckExplanation` gains `question: string`. It is **required**, not optional — an optional field
lets a check silently ship without one, which is the failure mode this codebase keeps rediscovering.

### 3. Audit `fix.{pass,warn,fail}` — report, do not rewrite

120 strings across both locales. Apply the same three categories and produce a list of which
overclaim, with the offending phrase quoted. **No edits.** Rewriting them is a larger piece of work
and belongs in its own slice, decided once the size is known rather than guessed at now.

### 4. A parity guard

There is no test referencing `CHECK_EXPLANATIONS` anywhere in `__tests__/`. Nothing would notice a
check missing from one locale, an empty string, or a `question` that was never added. Add a test
asserting, for both locale records: every check id is present, and every field (`question`, `why`,
`fix.pass`, `fix.warn`, `fix.fail`) is a non-empty string.

**The expected id list must come from `lib/types.ts`, not from `Object.keys(CHECK_EXPLANATIONS)`.**
Deriving the expected set from the object under test makes the guard circular: it would pass happily
with a check missing from *both* locales, which is precisely the case worth catching. `lib/types.ts`
is where `c1`–`c20` are declared and is the independent source of truth.

The guard must be watched failing before it is trusted — delete one locale's entry, see it fail,
restore.

## Consumers

Four files touch this, and only two read the data:

- `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx:241` — reads `CHECK_EXPLANATIONS[key]`
  directly, **not** locale-aware. This is a live bug the slice should fix: the dashboard result page
  shows English explanations to a zh-HK user. Switch it to `getCheckExplanations(locale)`.
- `components/result/ResultClient.tsx:128` — already correct, calls `getCheckExplanations(locale)`.
- `components/dashboard/ScanSummary.tsx:97` — reads `CHECK_EXPLANATIONS[key]` directly. Same bug,
  same fix.
- `components/ExpandableCheckItem.tsx` — receives `explanation` as a prop and imports only the type.
  It renders `why` and `fix`; it must be extended to render `question`, or the new field ships
  invisible.

## Testing

- The parity guard above, watched failing.
- `npm run lint`, `npm run typecheck`, `npm run test:unit` all clean.
- Adding a required field to `CheckExplanation` makes every incomplete entry a type error, so
  `typecheck` is itself a completeness check for component 2.

## Out of scope

- The 71 status-message keys in `messages/*.json`. They are already bilingual and describe observed
  states rather than making claims.
- Marketing and pricing page copy.
- The coverage-gated scoring model — a separate and much larger product decision.
- Rewriting `fix.*`. Audited here, changed later.
