# Plan: Result Page Redesign — Email Gate + Deep GEO

## Goal
Transform the post-scan result page from a technical audit dump into a
conversion-optimised experience:
1. Theatrical score reveal
2. "#1 Issue" card (personalised, plain-English)
3. Email capture gate (unlocks full results)
4. Deep GEO breakdown after email
5. Fix Pack gated behind signup (unchanged)

## Tasks

### Task 1 — Migration: add lead_email to scans
- Create `supabase/migrations/015_scan_lead_email.sql`
  - `ALTER TABLE scans ADD COLUMN IF NOT EXISTS lead_email text;`
- Run `supabase db push`

### Task 2 — API: lead capture endpoint
- Create `app/api/scan/lead/route.ts`
  - POST `{ scanId, email }`
  - Validate email format
  - `UPDATE scans SET lead_email = $email WHERE id = $scanId`
  - Return `{ ok: true }`

### Task 3 — Component: ResultClient (orchestrator)
- Create `components/result/ResultClient.tsx`
  - Client component, manages phase state: `'reveal' | 'unlocked'`
  - Renders ScoreReveal → TopIssueCard → EmailCaptureGate → (if unlocked) FullResults + DeepGeoSection
  - Passes all scan data down as props (no extra fetches)

### Task 4 — Component: ScoreReveal
- Create `components/result/ScoreReveal.tsx`
  - Animated count-up from 0 to `score` over 1.2s
  - Grade badge with colour-coded background
  - Domain + industry/region pill
  - Industry benchmark mock ("Avg. technology company: 61/100") — hardcoded per industry for now

### Task 5 — Component: TopIssueCard
- Create `components/result/TopIssueCard.tsx`
  - Finds highest-priority failing check (Core fails first, then Extended, then GEO)
  - Maps check key → plain-English headline + why-it-matters copy
  - Red/orange card with icon
  - "You have X more issues. Unlock your full report →"

### Task 6 — Component: EmailCaptureGate
- Create `components/result/EmailCaptureGate.tsx`
  - Email input + "Send my report" button
  - On submit: POST /api/scan/lead → set phase = 'unlocked'
  - Shows what they unlock: full 20-check breakdown + GEO deep-dive
  - Loading and error states

### Task 7 — Component: DeepGeoSection
- Create `components/result/DeepGeoSection.tsx`
  - Shown only after email capture
  - C17 Citation Density: authority tier breakdown bars (T1/T2/T3), citations-per-1000-words
  - C18 Factual Density: number density %, has-comparisons badge, quality score bar
  - C19 Topical Authority: cluster count, orphan page warning, coverage score bar
  - C20 Chunkability: chunk count, optimal ratio %, FAQ style badge
  - Each metric card explains WHY it matters for AI citation in plain English

### Task 8 — Component: LockedPreview
- Create `components/result/LockedPreview.tsx`
  - Shows 3-4 blurred/greyed check rows with a lock overlay
  - Copy: "20 checks analysed — enter your email to see all"

### Task 9 — Redesign result page
- Rewrite `app/[lang]/result/[id]/page.tsx`
  - Keep as async Server Component (data fetch unchanged)
  - Remove all old inline JSX
  - Pass scan data to `<ResultClient scan={s} lang={lang} />`

### Task 10 — Improve scan loading state (homepage)
- Update `app/[lang]/page.tsx`
  - After submit, replace hero section with an inline scanning animation
  - Show animated check icons ticking off: "Checking robots.txt…", "Reading llms.txt…", etc.
  - Redirect when API resolves

## Verification
- `npm run build` passes with no type errors
- Result page renders correctly at `/en/result/[id]`
- Email capture POSTs to `/api/scan/lead` and stores in DB
- Phase transitions work: reveal → locked preview → unlocked full results
- Deep GEO section renders all 4 check cards post-email
