# UX Phase 5: dashboard, Monitor, onboarding

Evidence for the Phase 5 PR. "Before" is `main` at `c00f12b7` (Phases 1–4
merged); "after" is `ux/phase-5-dashboard`.

## Is Pulse scheduled? (checked before presenting Monitor as live)

No evidence that it runs. `cloudflare/aiso-worker/wrangler.jsonc` schedules
Pulse daily at 04:17 UTC and alerts on Mondays at 07:47 UTC, but production's
Vercel runtime logs for 2026-10-16 → 2026-10-23 contain no Pulse activity at
all. A Pulse run always writes a log line: model usage from `pulse/run`, or
`[cron/pulse] no client has an active prompt bank` when there is nothing to do.
The same window shows `/api/scan` and `/api/funnel-events` lines, so logging
works. The Worker is most likely not deployed (or cannot reach the app); the
Cloudflare side and the database could not be checked from this session.
Deploying it is `docs/runbooks/deploy-cron-worker.md`.

So Monitor stays hidden (`MONITOR_VISIBLE = false`), and its new status line
says how fresh the results are: "latest results: week of …", "no new results
since …" or "no weekly results yet". It never claims the schedule runs,
because a run started by hand also makes results fresh.

## What changed

- **Overview**: three stat cards (score, fixes left, points to gain) with
  sparklines and an arrow only when the latest two scans are comparable
  (`compareScanEvidence`), a score trend over the last ten scans on a fixed
  0–100 axis, and a next-best-action card as the page's focal point (the top
  observed fix when the next step would otherwise open hidden Monitor).
- **Getting started**: four steps — add brand, first scan, save top fixes,
  choose questions to track — one illustration and one sentence each, one
  button on the current step, ticked from stored rows only; it disappears when
  done and is not shown when a read fails. Step 4 says "questions", not
  "weekly Pulse", because Pulse is not running.
- **Monitor (hidden)**: result freshness (latest week / no new results since …
  / none yet), platform × week dots (ChatGPT, Perplexity, Gemini — never "cited",
  which the weekly data cannot show), you vs competitors as share of
  classified answers over four weeks, and alert on/off with the last alert.
- **States**: loading skeletons for the dashboard, the brand pages and Tasks;
  one error boundary for every dashboard page with an illustration and one
  retry button (the sidebar and top bar stay); illustrated empty states on
  Reports, Opportunities and Citations.
- **Upgrade prompts**: "2 of 3 scans left this month" on Basic; an upgrade card
  instead of the form when the month is used up or the plan is Free; the brand
  limit as an upgrade card on the brand list and in onboarding. The scan step
  and onboarding previously showed the raw API codes
  `AUTHENTICATED_SCAN_LIMIT_REACHED` and `BRAND_LIMIT_REACHED`.

## Screenshots

Offline fixtures of the real components with each side's production CSS,
full page, reduced motion. Dashboard routes need a session the test server
cannot create.

| | before / after |
|---|---|
| Overview | `overview-{en-light,zh-dark}-{390,1440}-{before,after}.jpg` |
| Monitor | `monitor-{en-light,zh-dark}-{390,1440}-{before,after}.jpg` |
| Scan step, month used up | `scan-out-…` |
| Brand list at the limit | `brand-limit-…` |

## Recordings

`overview-monitor-desktop.webm` (1280×800, en) and
`overview-monitor-mobile-zh.webm` (390×844, zh-HK): the checklist bar filling
to 2/4 and its steps rising in, the score trend growing from the left, the
competitor bars filling. Recorded from a temporary page (not committed) that
mounted the real components in the production build. The same script
asserted, with and without reduced motion: the bar settles at exactly 2/4,
every `[data-reveal]` fires, and the competitor bars settle at their shares.
The only console error was a 401 from `RunProgress` polling the Pulse API
without a session, which the real dashboard always has.

## Performance

Lighthouse cannot load the dashboard, and no public page changed. Client JS
per route from the two production builds (`page_client-reference-manifest.js`,
gzip):

| Route | main | branch | Δ |
|---|---|---|---|
| `/dashboard/[clientId]` (Overview, Scan, Monitor) | 368 KB | 373 KB | +5 |
| `/dashboard` (brand list) | 156 KB | 158 KB | +2 |
| `/dashboard/[clientId]/opportunities` | 173 KB | 175 KB | +2 |
| `/dashboard/[clientId]/reports` | 160 KB | 162 KB | +2 |
| `/dashboard/[clientId]/tasks` | 156 KB | 158 KB | +2 |
| `/onboarding` | 142 KB | 145 KB | +3 |

Every dashboard route gains about 2 KB in shared code, not traced to one
module. Onboarding first
measured +11 KB: the upgrade card pulled in the whole empty-state module, so
illustrations now live in their own module (`components/ui/illustration.tsx`).

The charts are plain SVG and CSS (no Recharts on Overview). Animations use
transform and opacity only, 250 ms for UI and 800 ms for bars and the trend,
on the one easing curve, and rest in their final state without JavaScript or
with reduced motion.

## Accessibility

`tests/e2e/app-shell.spec.ts` now also runs axe on Monitor (en/zh-HK,
375/1440, light/dark), and the C8A fixtures cover the new Overview cards in
both themes at 375, 768 and 1440. Colour pairs are the registered `-fg on -soft`
tokens.
