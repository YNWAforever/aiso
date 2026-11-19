# Google AI Overviews in place of Perplexity Pro

Date: 2026-11-19. Owner decision: Pro and Enterprise plans will check **Google AI
Overviews** instead of **Perplexity Pro** in the weekly AI visibility checks. The
active-question cap stays at 10. Question suggestions now cover brand, market and
competitor angles (`feat(pulse): suggest brand, market and competitor questions`).

## Why this is not a label change

- No OpenRouter model serves Google AI Overviews (`lib/pulse/platforms.ts`,
  `google_aio`). The only collector available to this repo is DataForSEO's Live
  Google Organic SERP Advanced endpoint with `load_async_ai_overview: true`.
  The existing SERP client turns that flag off deliberately.
- Each check is **one billed DataForSEO task per question per week**. A brand with
  10 active questions costs 10 tasks a week, on top of the existing model calls.
- Google shows an AI Overview for only some queries, and coverage varies by
  market and language. For any question where Hong Kong / zh-TW search shows no
  overview, the platform records "absent" every week. If that is most questions,
  the swap would make visibility **less** accurate, the opposite of the goal.

## Step 1: measure (done on this branch)

- `lib/integrations/dataforseo/ai-overview.ts` fetches and parses the AI Overview
  for one question. It reports `present` (text plus sources), `absent` (Google
  showed none) or `failed`, and never treats an unexpected response as an answer.
  Covered by `__tests__/integrations/dataforseo-ai-overview.test.ts`.
- `npm run aio:probe -- --client <brand id>` lists the brand's active questions and
  spends nothing. With `--yes`, it runs one task per question and prints:
  - how often an AI Overview was shown
  - how often it named the brand (or one of its other names)
  - how often it named a recorded competitor

  It reads only, writes nothing, and never prints a credential.

**Run this on two or three real brands before Step 2.** If the AI Overview rate is
low, keep Perplexity Pro or add AI Overviews alongside it instead.

## Step 2: the swap (not built yet)

1. **Vocabulary.** Add entitlement key `google-aio` → runtime key `google-aio` →
   citation key `google_aio` (already allowed by `ai_citation_log`'s CHECK). Update
   `lib/pulse/platforms.ts` and its boundary tests together.
2. **Plans.** In `lib/plans/catalog.ts`, replace `perplexity-p` with `google-aio`
   for Pro and Enterprise. Update the pricing page and feature lists, plus the
   labels in `brand-month/labels.ts`, `monitor-signals.ts`, `PlatformBar` and
   `CombinedReport`.
3. **Producers.** `callMultiPlatform` (OpenRouter) stays chat-only. Both Pulse
   producers (`app/api/pulse/run` and the `lib/pulse/runs` queue) dispatch
   `google-aio` to the DataForSEO collector. An `absent` overview is saved as a
   real "no AI Overview" observation, not a failure, and is not retried.
4. **Studio.** AI Overviews answer search queries, not chat turns, so the LIVE
   model picker excludes `google-aio`.
5. **History.** Earlier `perplexity-sonar-pro` rows stay as they are. Weekly
   comparisons treat the platform change as a coverage change, not a score change.

Each part ships with its tests, and the plan change merges only after Step 1's
numbers are reviewed.
