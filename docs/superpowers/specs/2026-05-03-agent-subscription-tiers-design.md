# Agent Subscription Tiers & Client Portal Wizard — Design Spec

## Overview

Redesign the client portal around a guided 4-step wizard flow (Scan → Results → Improve → Monitor) with agent-based subscription tiers. Basic ($29/mo) gets Gemini-only analysis. Pro ($79/mo) unlocks all 5 AI platforms plus progress tracking. Enterprise ($199/mo) adds competitor intelligence, alerts, and CSV export.

Locked panels show blurred previews with upgrade CTAs throughout the wizard, driving natural conversions.

---

## Subscription Tiers

| Feature | Basic ($29/mo) | Pro ($79/mo) | Enterprise ($199/mo) |
|---|---|---|---|
| AISO Scan (20 checks) | ✓ | ✓ | ✓ |
| Agent analysis platforms | Gemini only | All 5 (GPT-4o, Claude, Gemini, Perplexity Sonar/Pro) | All 5 |
| Recommendations | ✓ (Gemini) | ✓ (all 5) | ✓ (all 5) |
| Progress tracking | — | ✓ | ✓ |
| Competitor intelligence | — | — | ✓ |
| Alerts (SoV + WoW) | — | ✓ | ✓ |
| CSV/PDF export | — | — | ✓ |
| Max brands | 1 | 3 | 10 |
| History weeks | 4 | 26 | 999 |
| Edit prompts | — | ✓ | ✓ |

---

## Wizard Flow

Four sequential steps with a top progress bar replacing the sidebar navigation:

```
[1. Scan]  →  [2. Results]  →  [3. Improve]  →  [4. Monitor]
  Active       Completed         Locked (Pro)     Locked
```

**Step 1 — Scan**: URL input, optional industry/region, "Run Scan" button. Scan history below.

**Step 2 — Results**: Full 20-check results with score ring, grade, expandable checks. Same for all tiers. "Next →" button.

**Step 3 — Improve**: Agent analysis section. Gated per plan:
- Basic: Gemini recommendations only. Pro/Enterprise panels locked.
- Pro: All 5 platforms recs + progress. Enterprise competitors panel locked.
- Enterprise: Everything active.

**Step 4 — Monitor**: SoV trends + missed opportunities. Alerts locked for Basic.

**Step navigation**: Completed steps clickable. Locked steps show padlock. Current step highlighted.

---

## LockedFeature Component

Reusable component for gated panels. Takes `plan`, `price`, optional `preview` children.

Shows: padlock icon, feature name, blurred preview (if provided), plan requirement text, "Upgrade →" button that triggers Stripe checkout for the specific plan.

---

## Data Model

### Modified

**`accounts`**: Plan values change from `'starter'/'pro'/'enterprise'` to `'basic'/'pro'/'enterprise'`. Existing `'starter'` rows migrated to `'basic'`.

**`scans`**: New column `agent_platforms text[]` — records which platforms were triggered (e.g., `{gemini}` for Basic, `{gemini,gpt4o,claude,perplexity-s,perplexity-p}` for Pro).

### New

**`plan_features`** — declarative feature config:

| Column | Type | Purpose |
|---|---|---|
| `plan` | text PK | 'basic', 'pro', 'enterprise' |
| `platform_access` | text[] | Platforms included |
| `agent_recs` | boolean | Recommendations access |
| `agent_progress` | boolean | Progress tracking |
| `agent_competitors` | boolean | Competitor intelligence |
| `alerts` | boolean | Alert system |
| `csv_export` | boolean | CSV/PDF export |
| `max_brands` | smallint | Brand limit |
| `history_weeks` | smallint | History retention |
| `edit_prompts` | boolean | Prompt bank editing |

---

## Stripe Integration

Three Stripe price IDs (env vars): `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`.

**Checkout** (`/api/stripe/checkout`): Accepts `plan: 'basic' | 'pro' | 'enterprise'` + `annual: boolean`. Maps to correct Stripe price. Same auth flow — requires profile.

**Webhook** (`/api/stripe/webhook`): Updated `getPlan()` helper maps price IDs to plan names. Payment events upsert `accounts` with correct plan.

---

## Agent Gating

**Execution**: Scan route checks `accounts.plan`. Basic → webhook payload includes only Gemini. Pro/Enterprise → includes all 5. `agent_platforms` recorded on scan row.

**Display**: Client dashboard page checks `accounts.plan` via `planAllows()`. Filters agent data to only show platforms the user has access to. Locked panels render `LockedFeature` components.

**Upgrade flow**: Current agent data preserved on upgrade. Hidden platform data becomes visible immediately on plan change. Data not deleted on downgrade — simply hidden.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Stripe checkout fail | Redirect to pricing with error toast |
| Webhook processing fail | Logged, Stripe auto-retries |
| Subscription cancelled | Active until period end, then downgrade |
| User upgrades mid-scan | Wizard refreshes, new panels unlock |
| User downgrades | Data preserved, locked panels reappear |
| No scans yet | Steps 2-4 show "Run your first scan" |
| Agent analysis pending | Improve step shows loading state |

---

## Migration

File: `supabase/migrations/014_subscription_tiers.sql`:
1. Create `plan_features` table with seed data
2. Update `accounts.plan` from `'starter'` → `'basic'`
3. Update plan constraint: `check (plan in ('basic', 'pro', 'enterprise'))`
4. Add `scans.agent_platforms text[] default null`

---

## File Plan

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/014_subscription_tiers.sql` | Create | Plan features table + migrations |
| `lib/tier.ts` | Modify | Replace constants with `planAllows()` reading plan_features |
| `lib/types.ts` | Modify | Update Account plan type, add PlanFeatures type |
| `app/[lang]/dashboard/[clientId]/page.tsx` | Modify | Replace tabs with wizard steps, add gating logic |
| `components/dashboard/WizardProgress.tsx` | Create | Top progress bar with 4 steps |
| `components/dashboard/LockedFeature.tsx` | Create | Reusable locked panel with upgrade CTA |
| `components/dashboard/ScanStep.tsx` | Create | Scan input wizard step |
| `components/dashboard/ResultsStep.tsx` | Create | Results display wizard step |
| `components/dashboard/ImproveStep.tsx` | Create | Agent analysis wizard step |
| `components/dashboard/MonitorStep.tsx` | Create | SoV monitoring wizard step |
| `app/api/stripe/checkout/route.ts` | Modify | Accept basic/pro/enterprise plans |
| `app/api/stripe/webhook/route.ts` | Modify | Map 3 price IDs to plans |
| `app/api/scan/route.ts` | Modify | Gate agent platforms by plan |
| `app/[lang]/pricing/page.tsx` | Modify | New 3-tier pricing display |
| `components/dashboard/Sidebar.tsx` | Delete/Replace | Removed in favor of wizard bar |
| `components/dashboard/PulseTabs.tsx` | Delete/Replace | Replaced by wizard steps |
| `app/[lang]/dashboard/settings/page.tsx` | Modify | Updated plan labels |
