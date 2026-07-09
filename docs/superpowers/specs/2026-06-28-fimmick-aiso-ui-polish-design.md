# Design: Fimmick AISO All-Pages UI/UX Polish
**Date:** 2026-06-28
**Status:** Approved

---

## Overview

Polish every page and subpage into one coherent Fimmick AISO interface without changing the product structure. The app should feel like a precise AI visibility operations console: calm, trustworthy, data-dense where users need repeated work, and clear enough for first-time public scan visitors.

The pass covers:

- Public funnel: `/[lang]`, `/[lang]/pricing`, `/[lang]/auth/login`, `/[lang]/onboarding`
- Public report: `/[lang]/result/[id]`
- Dashboard shell: `/[lang]/dashboard`, `/[lang]/dashboard/[clientId]`, settings, redirects, and nested result pages
- Pulse/reporting: `/[lang]/pulse/[clientId]` and question-bank anchor flow
- Admin: `/admin`, `/[lang]/admin/authority`

The current route structure, business logic, plan model, scan flow, Pulse flow, and onboarding flow remain intact. Small copy and hierarchy edits are allowed only when they directly improve clarity.

---

## Design Thesis

Fimmick AISO should not look like a generic AI landing page. It should look like an evidence console for AI search visibility.

The signature element is a shared **visibility dossier** grammar:

- Score ring or score block
- Status chips for pass, warning, fail, locked, live, pro
- Evidence rows for checks, prompts, platforms, missed opportunities, and admin records
- Compact issue/action panels that show what matters now
- Consistent platform chips for ChatGPT, Perplexity, Claude, Gemini, Google AIO

This language should appear across homepage previews, result pages, dashboard steps, Pulse, and admin tables so users learn one visual system.

---

## Scope Decisions

### Keep

- Existing product structure and page order
- Current bilingual content system
- Existing route and API contracts
- Existing component boundaries where they still fit
- Geist font stack for stability and no extra font-loading risk
- Tailwind v4 token-based styling approach in `app/globals.css`

### Improve

- Shared tokens for light and dark mode parity
- Dashboard readability: less 10px text, clearer route headers, better content width rules
- Card, table, form, status, and empty-state consistency
- Public funnel hierarchy and visual proof density
- Result report trust and scan summary readability
- Pulse chart/table accessibility and responsive behavior
- Admin table polish and action states
- Keyboard focus, aria labels, touch targets, reduced motion, and status semantics

### Avoid

- Full rebrand
- New page architecture
- New pricing/product tiers
- New animations that do not explain state
- Decorative gradient blobs or one-note blue/purple treatment
- Emoji or text glyphs as structural UI icons
- Dense nested cards or cards inside cards

---

## Visual System

### Color Tokens

Use semantic tokens rather than raw per-component hex values.

| Role | Light | Dark | Usage |
|---|---:|---:|---|
| Background | `#F8FAFC` | `#050510` | App/page base |
| Surface | `#FFFFFF` | `#0D0D18` | Cards, panels, nav |
| Elevated | `#F1F5F9` | `#141422` | Secondary surfaces |
| Foreground | `#0F172A` | `#E5E7EB` | Primary text |
| Muted | `#64748B` | `#9CA3AF` | Secondary text with contrast checked |
| Primary | `#1E40AF` | `#38BDF8` | Primary action and active nav |
| Primary hover | `#1D4ED8` | `#7DD3FC` | Hover/pressed states |
| Attention | `#B45309` | `#FBBF24` | Upgrade, warning emphasis |
| Success | `#15803D` | `#4ADE80` | Positive status |
| Warning | `#B45309` | `#FBBF24` | Warning status |
| Danger | `#B91C1C` | `#F87171` | Failing/destructive status |
| Border | `#DBEAFE` | `#1E293B` | Dividers and panel outlines |

Primary blue is for hierarchy and action. Amber is reserved for attention moments such as upgrade prompts, warnings, and trial urgency. Status colors must always include text or icon labels, never color alone.

### Typography

- Keep Geist Sans and Geist Mono.
- Raise small dashboard body copy from 10-12px to 13-14px where it carries meaning.
- Keep 10-11px text only for metadata, compact badges, and secondary labels.
- Use tabular numbers for scores, percentages, dates, and table metrics.
- Route headers use a consistent title, description, and optional action layout.
- Avoid negative letter spacing and viewport-scaled text.

### Radius, Border, Shadow

- Operational cards and panels: 8px radius by default.
- Marketing/report hero elements may use 12px only when they are prominent single objects.
- Avoid stacked card-in-card layouts.
- Use borders for structure and small shadows only for nav, modals, and important floating UI.
- Hover states should change color, border, or elevation without shifting layout.

### Motion

- Micro-interactions: 150-250ms.
- Page content reveal may use existing fade-up only where it does not delay core information.
- Remove decorative continuous motion except loading states.
- Add `prefers-reduced-motion` support for custom animations.

---

## Page Family Designs

### 1. Public Home

Goal: Convert a visitor to run a scan while making the product feel credible.

Design updates:

- Keep current hero structure: nav, headline, scan form, optional personalization, product preview.
- Tighten hero hierarchy so scan input is the obvious first action.
- Replace glyph disclosure arrows with a Lucide chevron.
- Convert the right-side mockup into the same visibility dossier style used by results.
- Make AI platform strip look like evidence chips, not decorative badges.
- Reduce overly large marketing card spacing in lower sections.
- Replace embedded emoji status text in translations or render status icons separately.
- Make bottom CTA use the same scan form pattern as the hero.

### 2. Pricing

Goal: Make plan differences easy to compare and checkout safe to start.

Design updates:

- Keep three-plan structure and monthly/annual toggle.
- Make the toggle keyboard-visible with `aria-pressed` or equivalent state.
- Keep Pro as the recommended plan, but reduce visual distortion from scaling.
- Make plan cards equal-height with clearer feature grouping.
- Improve mobile comparison table with horizontal scroll affordance or stacked plan summaries.
- Move checkout errors to a shared location near the relevant action, not only inside the Pro card.
- Replace right-arrow text glyphs with Lucide icons.

### 3. Login and Onboarding

Goal: Make auth and setup feel connected to the product, not like isolated forms.

Design updates:

- Use the Fimmick AISO name consistently.
- Add a small product-context panel or compact benefits list only if it does not slow login.
- Ensure labels, helper text, error text, and button loading states are visible and accessible.
- Onboarding should use the same progress grammar as the dashboard workflow.
- Keep fields at least 44px tall.

### 4. Public Result Page

Goal: Make the scan result feel trustworthy enough for a visitor to unlock and act.

Design updates:

- Use visibility dossier layout for score, status counts, top issue, impact teaser, and locked preview.
- Replace pass/warn/fail emoji with Lucide status icons and text.
- Keep score and domain above the fold on mobile.
- Make locked/unlocked states feel like the same report, not separate products.
- Keep email capture close to the value being unlocked.
- Make "scan another URL" a clear secondary action with an icon, not an arrow glyph.

### 5. Dashboard Shell

Goal: Make repeat work fast and orientation obvious.

Design updates:

- Keep sidebar-led structure on desktop.
- Improve sidebar dark-mode token usage and remove light-only surfaces.
- Replace lock emoji with a Lucide lock icon and accessible label.
- Increase nav item readability and touch target height.
- Add consistent active, hover, disabled, and focus states.
- Make brand context and plan state quieter but scannable.
- Add mobile fallback navigation if the current sidebar blocks small screens.

### 6. Dashboard Home

Goal: Show tracked brands, recent scans, and next action clearly.

Design updates:

- Use a shared page header component pattern.
- Make empty state action-oriented and visually aligned with other empty states.
- Standardize brand cards and recent scans as compact operational cards.
- Keep grid responsive without horizontal scroll.

### 7. Client Workflow Page

Goal: Make scan, results, improve, and monitor feel like one flow.

Design updates:

- Keep query-param step model.
- Use route header with step title, description, and contextual action.
- Normalize max-width decisions: scan/results can be narrower; monitor/Pulse previews can be wider.
- Standardize no-scan and locked states.
- Ensure Improve and Monitor use consistent pro-lock language and affordances.

### 8. Pulse Page

Goal: Make AI visibility monitoring readable as analytics, not as a loose stack of cards.

Design updates:

- Keep sections: Overview, Scan Log, Question Bank.
- Add stronger page header with brand, week, and section anchors.
- Use accessible chart colors, labels, tooltips, and empty/error states.
- Make Missed Opportunities table readable on mobile with overflow handling and no cramped ticks.
- Standardize Question Bank controls with visible labels, button states, and focus management.
- Use platform chips consistently across chart, table, and scan log.

### 9. Settings

Goal: Make plan and billing actions obvious without extra decoration.

Design updates:

- Use dashboard page header pattern.
- Show current plan, billing state, and upgrade action as a compact account panel.
- Replace arrow glyphs with icons.
- Add clearer disabled/unavailable states for absent Stripe billing.

### 10. Admin

Goal: Make internal control surfaces legible, dense, and safe.

Design updates:

- Align `/admin` and `/[lang]/admin/authority` with the same admin shell.
- Replace hardcoded slate colors with semantic tokens.
- Add loading, empty, and error states.
- Improve table headers, row hover, status chips, and select controls.
- Keep destructive or privileged actions visually separated from normal navigation.
- Replace back arrow glyph with a Lucide icon.

---

## Shared Components and Patterns

Create or standardize these patterns where they reduce duplication:

| Pattern | Purpose |
|---|---|
| App/product logo mark | Consistent Fimmick AISO lockup across public, dashboard, result, admin |
| Page header | Title, description, status/meta, optional action |
| Surface/card classes | Shared radius, border, background, spacing, dark-mode behavior |
| Status chip | Pass, warn, fail, locked, pro, live, active, inactive |
| Metric tile | KPI number, label, optional delta, tabular numerals |
| Empty state | Icon, title, explanation, primary action |
| Table shell | Responsive overflow, consistent header/row/cell styling |
| Form field treatment | Label, helper, error, focus, disabled, loading |
| Section anchor nav | For Pulse and long reports |

Use Lucide icons for status and controls whenever an icon exists. Icon-only buttons require accessible labels.

---

## Accessibility Requirements

- Normal text contrast at least 4.5:1.
- Secondary text contrast at least 3:1, preferably higher on data-heavy pages.
- All interactive controls must have visible focus states.
- Icon-only controls need `aria-label` or visible text.
- Touch targets should be at least 44px high where practical.
- Forms need visible labels and error text near the field.
- Loading buttons must be disabled and show feedback.
- Tables need readable headers; sortable tables should use `aria-sort` when sorting exists.
- Charts need a text summary or nearby labels that explain the key insight.
- Status must not rely on color alone.
- Reduced-motion preferences must be respected.
- Navigation must remain predictable when moving between public, dashboard, Pulse, and admin pages.

---

## Responsive Requirements

Test and support:

- 375px mobile portrait
- 768px tablet
- 1024px laptop
- 1440px desktop

Rules:

- No horizontal page scroll.
- Tables may use contained horizontal overflow with visible affordance.
- Fixed/sticky navigation must not hide content.
- Dashboard sidebar needs a small-screen fallback.
- Long text should wrap before truncating.
- Buttons and chips should not resize surrounding layout on hover or loading.

---

## Implementation Notes

- Before touching Next.js route or layout code, read the relevant local Next.js 16 guide in `node_modules/next/dist/docs/` per `AGENTS.md`.
- Prefer editing existing components and tokens over creating a parallel design system.
- Keep changes grouped by page family to simplify review.
- Avoid changing API behavior unless a UI state cannot be represented safely without it.
- Keep bilingual keys stable unless a small copy clarity edit requires updating `messages/en.json` and `messages/zh-HK.json`.
- Do not touch unrelated MCP launcher work currently in the worktree.

---

## Verification Plan

Automated:

- Unit tests: `npm test`
- Build/type verification if route code changes: `npm run build`
- Lint when repo tooling is available. Current lint is known to be blocked by existing ESLint/tooling issues unless fixed separately.

Visual/manual:

- Run the app locally.
- Capture desktop and mobile screenshots for public home, pricing, result, dashboard home, client workflow, Pulse, settings, and admin.
- Check dark mode on dashboard/report surfaces.
- Keyboard-tab through nav, forms, pricing toggle, result unlock, dashboard sidebar, Pulse controls, and admin tables.
- Verify no emoji or glyph-only structural controls remain in UI code.
- Check loading, empty, locked, and error states for the main page families.

---

## Out of Scope

- Rewriting scan, Pulse, Stripe, Supabase, or OpenRouter logic
- New onboarding steps
- New admin features
- New chart types beyond accessibility/responsive polish
- A marketing content rewrite
- A new brand identity or custom illustration system
- Deployment or Vercel configuration changes
