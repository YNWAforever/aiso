# Target information architecture

Status: proposal for review (Phase 0). Nothing here is implemented yet. Names in quotes are placeholders
until the naming decision is made (see `audit.md` → Decisions).

Journey: **Scan → Understand → Fix → Monitor**. Every screen maps to one of these four verbs.

## 1. Navigation

### Public (marketing) header
```
[logo] Fimmick AISO     How it works   Pricing   Sample report        EN|中   Sign in   [ Scan free ]
```
- Four destinations instead of the current Home, Pricing, Scan, Sample report, Platform (9), Solutions (5)
  and Company (7).
- Desktop nav from `md` (768 px), not `xl`.
- The primary CTA always scrolls to or focuses the hero URL input. It does not go to a separate `/scan`.

### Footer
Product (How it works, Pricing, Sample report, Methodology) · Company (Security & trust, Contact) ·
Legal (Privacy, Terms — **pages needed**) · Language.

### App shell (signed in)
```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ [Brand ▾]    │  Overview / Scan & Fix / Tasks          ⌘K   🔔   ?   (avatar)│
│              ├──────────────────────────────────────────────────────────────┤
│ ◉ Overview   │                                                              │
│ ◎ Scan & Fix │                     page content                             │
│ ◎ Monitor    │                                                              │
│ ◎ Reports    │                                                              │
│ ◎ Settings   │                                                              │
│              │                                                              │
│ ─────────    │                                                              │
│ Plan: Basic  │                                                              │
│ [Upgrade]    │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```
On mobile the sidebar becomes a bottom tab bar with the same five items. The brand switcher moves into the
top bar.

| Nav item | Contains (tabs or sections) | Replaces |
|---|---|---|
| **Overview** | Score + trend, next best action, onboarding checklist, 3 StatCards | `?step=home`, portfolio card for the active brand |
| **Scan & Fix** | Latest result (canonical) · Fixes (Fix pack + AI recommendations + opportunities, merged) · **Tasks** (status filter: Draft / In review / Approved / Delivered / Measured) · Scan history | `?step=scan`, `?step=results`, `?step=improve`, `/result/[scanId]`, `/opportunities`, `/work-items/*/versions` (approvals, change-sets, delivery, outcomes) |
| **Monitor** | AI answers (PlatformDots matrix) · Competitors · Citations · Questions · Alerts | `?step=monitor`, `/pulse/[clientId]`, `/observations`, `/citations`, `/competitors`, `/prompts` |
| **Reports** | Report list · builder · share links | `/reports*` (and `?step=roi`; see note) |
| **Settings** | Brand profile (identity, approved facts, pages & Search Console) · Plan & billing · Members · Report branding · Integrations | `/entities`, `/sources`, `/assets`, `/dashboard/settings` |

The portfolio (`/dashboard`) becomes the **brand switcher** dropdown, plus an "All brands" page for agencies
with several brands.

Open question: **Local Trust / ROI** has no natural home in the five items. My proposal is a "Local
visibility" section in Overview for brands that set it up, with Reports carrying the ROI numbers. Please
confirm.

Admin (`/admin/*`) stays separate and unchanged.

## 2. Old → new route map

Old routes keep working: each one gets a permanent redirect, or a `?tab=` rewrite where the target is a tab.
Redirects for the authenticated subtree go in the route itself (`redirect()`), because `proxy.ts` must stay
intl-only and its matcher skips `/admin` and `/api`.

| Old route | New route | Kind |
|---|---|---|
| `/{lang}` | `/{lang}` (rebuilt) | — |
| `/{lang}/scan` | `/{lang}#scan` | 308 |
| `/{lang}/platform`, `/platform/*` (8) | `/{lang}/how-it-works#…` anchors | 308 (pending decision 4) |
| `/{lang}/solutions`, `/solutions/*` (4) | `/{lang}/pricing` or `/{lang}#who` | 308 (pending decision 4) |
| `/{lang}/integrations`, `/resources` | `/{lang}/how-it-works` | 308 |
| `/{lang}/security`, `/trust` | `/{lang}/trust` (merged "Security & trust") | 308 for `/security` |
| `/{lang}/methodology`, `/pricing`, `/sample-report`, `/contact` | unchanged, rebuilt | — |
| `/{lang}/result/[id]` | unchanged (public result, canonical layout) | — |
| `/{lang}/dashboard` | `/{lang}/app` → last-used brand Overview; `/app/brands` for multi-brand | 307 (path rename optional; can keep `/dashboard`) |
| `…/[clientId]?step=home` | `…/[clientId]` (Overview) | rewrite |
| `…/[clientId]?step=scan` / `results` | `…/[clientId]/scan` | 308 |
| `…/[clientId]/result/[scanId]` | `…/[clientId]/scan/[scanId]` | 308 |
| `…/[clientId]?step=improve`, `/opportunities` | `…/[clientId]/scan?tab=fixes` | 308 |
| `…/[clientId]/work-items/[id]/versions` | `…/[clientId]/tasks/[id]` | 308 |
| (new) | `…/[clientId]/tasks?status=…` | list view |
| `…/[clientId]?step=monitor`, `/pulse/[clientId]` | `…/[clientId]/monitor` | 308 |
| `…/observations`, `/citations`, `/competitors`, `/prompts` | `…/[clientId]/monitor?tab=answers\|citations\|competitors\|questions` | 308 |
| `…/[clientId]?step=roi` | `…/[clientId]#local` or `/reports?tab=roi` | 308 (pending) |
| `…/reports*` | unchanged | — |
| `…/entities`, `/sources`, `/assets` | `…/[clientId]/settings?tab=brand\|facts\|pages` | 308 |
| `/{lang}/dashboard/settings` | `/{lang}/settings` (account-level) | 308 |
| `/{lang}/onboarding` | unchanged (rebuilt stepper) | — |
| `/{lang}/r/[slug]` | unchanged (renders the shared report component) | — |
| `/{lang}/admin/authority` (stub) | remove or 404 | — |

Rules:
- **No API contract changes.** Only the page routes move.
- `e2e` gets a redirect-table spec that asserts each old URL lands on its new home in both locales.

## 3. Wireframes

### 3.1 Landing (mobile-first, 390 px; desktop puts the hero demo on the right)

```
┌─────────────────────────────────┐
│ [logo] AISO          EN|中   ☰  │
├─────────────────────────────────┤
│  Can AI recommend your business?│  ← one value line (≤8 words)
│                                 │
│  ┌───────────────────────────┐  │
│  │ yourwebsite.com           │  │  ← one input
│  └───────────────────────────┘  │
│  [      Scan free — 15 s     ]  │  ← one primary button
│  ✓ No signup   ✓ No card        │
│                                 │
│  ┌───────── HeroDemo ────────┐  │  6–8 s loop: URL types → beam sweeps
│  │  ▓▓ mock page ▓▓  ◜72◝    │  │  mock page → ring fills to 72 →
│  │  ░░░░░░░░░░░░░░   ◟  ◞    │  │  platform icons light "can cite you"
│  │  ● ChatGPT ● Perplexity ● G│  │  (static frame when reduced motion)
│  └───────────────────────────┘  │
├─────────────────────────────────┤
│  How it works                   │
│   (1)───────(2)───────(3)       │  line draws on scroll
│   Scan      Fix      Monitor    │  icon + 1 line each
├─────────────────────────────────┤
│  What we check                  │
│  ┌Core──┐ ┌Extra─┐ ┌GEO───┐     │  three pillar cards, icon grid
│  │▦▦▦▦▦ │ │▦▦▦▦▦ │ │▦▦▦▦  │     │  + mini progress bar each
│  │45 pts│ │30 pts│ │25 pts│     │  (stacked on mobile)
│  └──────┘ └──────┘ └──────┘     │
├─────────────────────────────────┤
│  Not cited   │   Cited by AI    │  before/after split, mock chat answer
│  🤖 "Try…"   │  🤖 "…[yourbrand]"│
├─────────────────────────────────┤
│  Sample report (real preview) → │
│  Pricing  ✓/✗ table (4 tiers)   │
│  FAQ (5, accordion)             │
│  12,345 sites scanned · logos   │  animated counters (real numbers only)
│  [ Scan free ]  ← one CTA here  │
│  footer                         │
└─────────────────────────────────┘
```

### 3.2 Scan progress → Result

```
PROGRESS (inline, replaces the hero card; same URL until done)
┌─────────────────────────────────┐
│ Scanning yourwebsite.com        │
│  ◜ 38 ◝   ← score rises live    │
│ Core      ✓✓✓●○                 │  pending ○ → running ● → ✓ / ✗
│ Extended  ✓✓✗✓✓✓○○○○○           │  bucket label highlights
│ GEO       ○○○○                  │  while it runs
└─────────────────────────────────┘

RESULT
┌─────────────────────────────────────────────────────────────┐
│ yourwebsite.com                         [Share] [PDF] [Save]│
│                                                             │
│        ◜ 68 ◝   C          "AI can read you, but rarely     │  ← one focal point:
│        ◟    ◞               quotes you."                    │     ring + grade + 1 line
│                                                             │
│  PotentialScoreBar  68 ━━━━━━━━━━━━━━━░░░░░ 86 if top-3 done│
├─────────────────────────────────────────────────────────────┤
│  Top 3 fixes                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🗎  Add an AI guide file       +8 pts  ·  10 min   → │   │  icon, 1-line problem,
│  │ 🛈  Answer FAQs on key pages   +6 pts  ·  1 hr     → │   │  impact chip, effort chip
│  │ 🔗  Add business details       +4 pts  ·  15 min   → │   │  → opens drawer
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Core ◔ 38/45     Extended ◑ 18/30     GEO ◔ 12/25          │  three PillarGauges
├─────────────────────────────────────────────────────────────┤
│  CheckHeatmap   ■■■■■ ■■■□■■■■■■■ ■□■■                      │  20 tiles, colour + icon
│  [All] [Failing] [Core] [Extended] [GEO]                    │  filters
│  ▸ detail list (collapsed rows)                             │
├─────────────────────────────────────────────────────────────┤
│  (anonymous) Save this report — free account  [Google] [✉]  │  one prompt, not a wall
└─────────────────────────────────────────────────────────────┘

DRAWER (one failing check)
┌───────────────────────────────┐
│ ✗ AI guide file missing   ×   │
│ +8 pts · 10 min               │
│ before ░░ │ after ▓▓ (mini)   │
│ ┌ code ───────────────[copy]┐ │
│ │ # yourwebsite.com …       │ │
│ └───────────────────────────┘ │
│ [ Generate fix pack ]         │
│ Learn more ↓                  │
└───────────────────────────────┘
```

### 3.3 Overview (signed in)

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ [Acme ▾]     │ Overview                                   ⌘K  🔔  ?     │
│ ◉ Overview   ├──────────────────────────────────────────────────────────┤
│ ◎ Scan & Fix │ ┌ Next best action ────────────────────────────────────┐ │
│ ◎ Monitor    │ │ ✦ Add FAQ answers to /services   +6 pts   [Fix it →] │ │  ← focal point
│ ◎ Reports    │ └──────────────────────────────────────────────────────┘ │
│ ◎ Settings   │ ┌Score─────┐ ┌AI mentions┐ ┌Fixes done┐                  │
│              │ │ 68  ▲4   │ │ 3/12  ▲1  │ │ 5 / 9    │  StatCards with  │
│              │ │ ╱╲_╱‾    │ │ _╱‾╲_╱    │ │ ▓▓▓▓▓░░  │  sparkline + delta│
│              │ └──────────┘ └───────────┘ └──────────┘                  │
│              │ Score trend (12 weeks)  ───────────╱‾‾╲__╱‾‾             │
│              │                                                          │
│              │ ┌ Get set up  2/4 ─────────────────────────────────────┐ │
│              │ │ ✓ Add brand  ✓ First scan  ○ Top fixes  ○ Weekly Pulse│ │  until done
│              │ └──────────────────────────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────────────────────────┘
```
Mobile: the cards stack (action → stats in a 2-column grid → trend → checklist), with a bottom tab bar.

Empty state, before the first scan: one illustration, "Scan your site to see your score", and **[Scan now]**.
No zero-value StatCards.
