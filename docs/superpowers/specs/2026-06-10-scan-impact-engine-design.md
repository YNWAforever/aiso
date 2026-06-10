# Scan Impact Engine + Shareable Report Card — Design

**Date:** 2026-06-10
**Status:** Approved

## Problem

The result page shows scores and check statuses but never tells the user what a bad score *costs* them or what fixing it would *gain*. There is no impact framing — nothing converts "you scored 54" into "you are invisible to 3 of 5 AI platforms, and fixing 4 quick wins would lift you to 71 (B)".

## Decisions (confirmed with user)

- **Priority:** impact of results (over landing redesign / scan polish)
- **Style:** modelled estimates traceable to real checks — no invented traffic numbers
- **Placement:** one headline stat *before* the email gate (tease), full breakdown *after* (payoff)
- **Landing tie-in:** shareable OG report card only
- **Engine:** fully deterministic pure function; LLM narrative possible later

## 1. Impact engine — `lib/impact.ts`

A pure function `computeImpact(results, { industry, score, grade })` returning an `ImpactReport`, derived entirely from data already stored in `scans.results`:

- **`platformVisibility`** — per-platform status for ChatGPT, Perplexity, Claude, Gemini, Google AIO: `visible | partial | blocked`. Derived from c1 (robots.txt AI-bot rules) and c3 (bot access) details. Bot mapping: GPTBot→ChatGPT, PerplexityBot→Perplexity, ClaudeBot/anthropic-ai→Claude, Google-Extended→Gemini/Google AIO. Falls back to check status when details don't name bots.
- **`aiReadablePercent`** — blend of c5 extractability, c13 server rendering, and c20 `optimalChunkRatio`. Null if no data.
- **`quickWins`** — failing/warning checks ranked by points-recoverable ÷ effort using a static effort map (llms.txt = minutes; FAQ schema = hours; SSR = days). Each entry: check key, label, points gained, effort tag.
- **`projectedScore` / `projectedGrade`** — re-score with quick wins (effort ≤ hours) flipped to pass, using shared scoring weights from `lib/scoring.ts` (extracted from the scan route).
- **`headlineStat`** — single most alarming stat by priority: blocked platforms > low readable % > below industry benchmark > score uplift fallback.

`INDUSTRY_BENCHMARKS` moves out of `ScoreReveal.tsx` into the impact module — one source of truth.

**Error handling:** never throws; missing/legacy check data degrades to omitting that stat.

## 2. Result page integration

- **`ImpactTeaser`** (locked phase, between TopIssueCard and LockedPreview): headline stat + projected-score pill — "Your score could be **78 (B)** after fixes — unlock to see how".
- **`ImpactPanel`** (unlocked phase, above check breakdown):
  - Platform visibility grid — 5 platforms with green/amber/red status and one-line reason
  - AI-readable gauge (%)
  - Now → After score row with delta
  - Ranked quick-win list with **+N pts** badges and effort tags, anchor-linked to the matching check items
- Both compute client-side from `scan.results` via the existing `phase` state in `ResultClient.tsx`. No API or DB changes.

## 3. Shareable report card

- `app/[lang]/result/[id]/opengraph-image.tsx` using `next/og` `ImageResponse` (1200×630): dark branded card with domain, score ring, grade badge, pass/warn/fail counts. Shared result links render as a grade card in LinkedIn/WhatsApp/Slack. Migration 020's public-select policy on `scans` permits the server-side read. Unknown scan → generic branded card.
- `generateMetadata` on the result page: "{domain} scored {score}/100 ({grade}) on AI visibility".
- Share button on the result page (Web Share API, clipboard fallback).

## Testing

Vitest suite for `lib/impact.ts`: platform derivation from robots fixtures, readable% blending, quick-win ranking and projection math, headline priority order, degraded legacy-scan input.
