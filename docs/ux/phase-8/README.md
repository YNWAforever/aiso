# UX Phase 8: repo hygiene

Evidence for the Phase 8 PR. "Before" is `main` at the Phase 7 merge;
"after" is `ux/phase-8-hygiene`.

## Decisions (product owner, 2026-10-23)

| Question | Decision |
|---|---|
| Product name | **Fimmick AISO** |
| AI crawlers named in robots.txt | Search and user-triggered agents only; training crawlers stay under the wildcard rule |
| c7 (AI endpoint) | Publish a truthful `/.well-known/ai.json`, claiming no API, plugin or MCP server |
| Organization data | `Fimmick`, `https://www.fimmick.com`; no logo or `sameAs` until official ones exist |

## The site passes its own checks

Our own 20 checks, run against the home page (`general_b2c`, `global`).

| Check | Before (live, en / zh-HK) | After | Change |
|---|---|---|---|
| c1 robots | warn `robots_no_ai_rules` | pass | `app/robots.ts` names the AI search and user agents |
| c6 llms.txt links | warn `llms_full_txt_sparse` | pass | every sitemap page as a Markdown link, plus ai.json and the sitemap |
| c7 AI endpoint | fail `mcp_card_missing` | pass | `app/.well-known/ai.json/route.ts` |
| c9 meta description | pass / **warn** (zh-HK 39 chars) | pass | all 26 zh-HK and 2 en descriptions brought into 50–160 |
| c15 entity | warn `entity_signals_only` | pass | Organization JSON-LD on every public page |
| c16 freshness | fail `freshness_missing` | pass | `dateModified` from `SITE_CONTENT_UPDATED`, a real date kept by hand |
| c17 citations | fail | **warn** | the home page now cites the six standards the checks follow |
| c18 factual density, c19 topical authority | need the LLM provider | verify on production after merge (the preview is behind a Vercel login) | no change |

Score: **71 (B) → 89 (A)** on a local production build, counting c8 and c12
as before (they compare against the configured public origin, which a local
server does not run on), and c18/c19 as unavailable.

**c17 stays a warning, on purpose.** A pass needs either links to domains our
authority model rates tier 1 or 2 for the industry, or statistics with a
named source. The home page has neither to offer truthfully, and citing
sources or statistics only to pass would be exactly what the check exists to
catch.

Pinned so it stays this way:
- `__tests__/seo/self-checks.test.ts` runs c1, c2, c6, c7, c9 (every page
  description, both languages), c15 and c16 against what the site serves.
- `tests/e2e/self-checks.spec.ts` runs the HTML checks against the rendered
  home page in both languages, on desktop and mobile.

## Product name

- `lib/brand.ts` holds the name; `components/brand/Wordmark.tsx` draws the
  two-tone wordmark and replaces six hand-drawn copies (and needs no
  translation provider, which the onboarding wizard does not have).
- Copy that called the product "AISO" alone now says "Fimmick AISO", in both
  languages. "An AISO score / grade / scan / check" is a thing the product
  produces and stays as it is.
- "Fimmick AEO" is gone from outgoing request headers (`User-Agent`,
  OpenRouter's `X-Title`) and email subjects.
- **Enforced:** `npm run audit:text` now fails on "Fimmick AEO" in UI text
  or source, and on a bare "AISO" standing for the product. Before, it only
  counted spellings.
- **Not renamed, deliberately:** identifiers whose change is a deployment
  decision: the npm package name, the legacy hosts, the fallback sender
  address `alerts@fimmick-aeo.com` in `lib/resend.ts` (only used when
  `RESEND_FROM_EMAIL` is unset), and the header of `.env.example` (env files
  are off limits).

## README

258 lines → 113. What moved where:

| Section | Now |
|---|---|
| Project status, feature fences, scheduler readback | `docs/project-status.md` |
| Environment details (lazy clients, cron secrets, dead variables, E2E variables) | `docs/configuration.md` |
| Public scan deployment prerequisites | `docs/runbooks/public-scan-prerequisites.md` |
| Manual runtime readiness | `docs/runbooks/runtime-readiness.md` |
| Schema-equivalence rehearsal | `docs/runbooks/schema-equivalence.md` |

Corrected on the way, because they contradicted `CLAUDE.md`: the README
said several features were fenced (none are) and that RLS policies call a
missing Supabase function (migration `036` dropped them). It also listed
`PLAYWRIGHT_TEST_EMAIL`/`_PASSWORD` as E2E variables; they are dead.
`AGENTS.md` said the Neon migration was in progress; it is complete.

`__tests__/docs/readme-links.test.ts` checks that every relative link in the
README and the moved pages resolves, and that the README stays a front page.

## Evidence

| | |
|---|---|
| The new sources list under "What we check" | `evidence/checks-sources-en-1440.png`, `evidence/checks-sources-zh-HK-390.png` |

## Lighthouse (mobile, fixture server, single run)

| Page | perf | a11y | SEO | LCP | CLS | JS (budget) |
|---|---|---|---|---|---|---|
| /en | 87 | 100 | 100 | 3.4 s | 0 | 175 KB (200) |
| /zh-HK | 88 | 100 | 100 | 3.4 s | 0 | 175 KB (200) |

A single local run, not the median of three that CI's Lighthouse job asserts
on, so the performance score is within run-to-run noise of Phase 7's figures;
this phase adds no client script beyond the wordmark component.

## Verification

- `npm run lint`, `npm run typecheck`, `npm run audit:text`: clean.
- `npm run test:unit`: 474 files, 6,499 tests pass.
- Full Playwright suite against the production build with the CI component
  fixtures: 1,582 passed, none skipped.
