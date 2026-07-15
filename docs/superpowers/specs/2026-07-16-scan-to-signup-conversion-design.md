# Fimmick AISO Scan-to-Signup Conversion Design

**Date:** 2026-07-16  
**Status:** Approved in conversation  
**Primary objective:** Increase completed website scans and free product-account signups

## Context

Fimmick AISO already has a substantial AI-search visibility product: a public scan, a 20-check result, an impact model, Fix Packs, Neon Auth, onboarding, dashboards, AI Pulse, and paid tiers. The main growth problem is not missing product depth. It is that the public journey explains too much before value is demonstrated, then asks the visitor to pass through two conversion gates before an account is created.

The approved strategy is a product-led, proof-before-gate funnel:

```text
Landing page
  -> anonymous free scan
  -> score, platform status, and highest-impact issue
  -> free account signup
  -> full 20-check report and Fix Pack
  -> pre-filled onboarding
  -> dashboard opened on the completed report
  -> paid upgrade when monitoring or advanced features matter
```

Payment is not the first conversion. The first conversion is a free account that preserves the visitor's completed scan.

## Audit Evidence

The live deployment and the `main` branch were reviewed on 2026-07-16.

### Discovery and GEO/AEO gaps

- `/robots.txt`, `/sitemap.xml`, and `/llms.txt` return 404 on the live deployment.
- The homepage has a generic title and description but no homepage canonical, rich Open Graph configuration, Twitter metadata, or structured data.
- The root document does not set a locale-specific `lang` attribute.
- The product therefore fails several checks that it tells customers to fix.

### Funnel gaps

- The homepage is a 660-line Client Component, including large amounts of static marketing content that could be server-rendered.
- The primary nav sends “Get started free” to pricing instead of starting a scan.
- The current result flow first captures a lead email and later asks the visitor to start a trial with a magic link. This is a double gate.
- Onboarding can trigger a new scan even when the visitor has already completed one, breaking continuity and wasting the highest-intent moment.
- The result page contains the right raw ingredients—score reveal, top issue, impact teaser, locked preview, and trial CTA—but they are not organized as one account-unlock decision.

### Trust and message gaps

- Marketing copy alternates between 5 and 6 monitored platforms.
- The Fix Pack is described both as `llms.txt`/robots/FAQ schema and as Content Brief/Chunk Rewriter/Cluster Map.
- Pricing copy says the entry plan is permanently free while the rendered entry card is a paid Basic plan.
- Enterprise is described both as self-serve checkout and a contact-sales offer.
- The homepage makes broad platform claims before showing product evidence or explaining the limits of a scan.

### UX, accessibility, and localization gaps

- The scan URL field and personalization selects lack complete visible-label, `name`, and autocomplete semantics.
- The personalization disclosure lacks `aria-expanded` and `aria-controls`.
- Async error and progress messages are not consistently announced.
- The pricing toggle lacks explicit state semantics and uses focus styles that do not meet the current web-interface rules.
- Custom motion has no complete reduced-motion fallback.
- Automatic dark-mode activation conflicts with several hardcoded white and slate marketing surfaces.
- English and Traditional Chinese content is comprehensive, but critical funnel terms and product claims have drifted independently.

## Product and Conversion Principles

1. **Demonstrate value before asking for an account.** A visitor sees their real score and most important issue after the scan.
2. **One gate, one promise.** The account unlock explains exactly what becomes available: all findings, prioritized fixes, the Fix Pack, and a saved dashboard.
3. **Never repeat completed work.** The anonymous scan is claimed by the authenticated account and becomes the first dashboard baseline.
4. **Make the next action obvious.** Public CTAs start a scan; post-scan CTAs create an account; in-product CTAs address issues or upgrade.
5. **Use evidence-console language.** Scores, platform states, issue priority, and fix impact provide proof. Generic AI decoration does not.
6. **Make only defensible claims.** Platform counts, Fix Pack contents, timing, tiers, and prices must come from one source of truth.

## Approved Visual Direction

Two visual decisions were approved in the brainstorming companion:

- **Homepage:** proof-before-gate hierarchy rather than an education-heavy long-form hierarchy.
- **Result conversion:** inline evidence unlock rather than a modal that hides the report.

The visual language remains the approved “visibility dossier” system: calm light surfaces, strong information hierarchy, blue primary actions, restrained status colors, explicit labels, and real product evidence.

## Homepage Design

### Navigation

- Link the Fimmick AISO lockup to the localized homepage.
- Use a small set of anchors: How It Works, Pricing, Sign In.
- Make “Run Free Scan” the sole primary nav action and link it to the hero scan form.
- Keep the EN/繁中 control visible without displacing the primary action on mobile.

### Hero

Use an outcome-led message, not a feature inventory. Working English direction:

- Eyebrow: “Free AI Visibility Scan”
- Headline: “See whether AI recommends your brand.”
- Supporting copy: explain that the scan tests whether ChatGPT, Google AI, Perplexity, Claude, and Gemini can find, understand, and cite the website.
- Primary form: labeled URL field and “Run Free Scan” button.
- Trust microcopy: no signup to scan, approximate result time, and Fimmick attribution.

The Traditional Chinese version should be localized for Hong Kong business users, not translated word-for-word. Brand names and technical identifiers remain untranslated.

### Proof sequence

Immediately after the hero:

1. Compact proof strip with 20 readiness checks, 5 named platforms, and the 100-point score.
2. A realistic result dossier showing score, platform visibility, and a highest-impact issue.
3. A short three-step explanation: scan, understand, fix and track.
4. Methodology and capability sections for visitors who need deeper validation.
5. A repeated scan form, not a generic “get started” banner.

The current feature inventory and Authority Engine content may remain below the proof sequence after claims are reconciled and density is reduced.

## Scan Experience

- Keep the scan anonymous and free.
- Validate and normalize the URL before submission.
- Preserve the submitted URL after errors.
- Show real progress labels for the checks being performed without implying exact progress when the backend cannot provide it.
- Use an accessible live region for progress and errors.
- Keep optional industry and region personalization, with visible labels and disclosure semantics.
- On success, navigate to the localized result URL without losing the scan context.
- Rate-limit and validate the public endpoint without requiring a new paid service.

## Result and Account-Unlock Design

### Public evidence

The unauthenticated visitor sees:

- Scanned domain and scan timestamp.
- Score and grade.
- Pass, warning, and fail counts.
- Platform visibility summary derived from the scan.
- Highest-impact issue with plain-language consequence.
- A defensible projected uplift or points-recoverable statement when the existing deterministic impact engine supports it.

The page must not fabricate benchmarks, traffic, revenue, or citation outcomes.

### Inline account unlock

The signup card remains inside the report and keeps the evidence visible. It promises:

- All 20 findings.
- Prioritized fixes.
- The defined Fix Pack outputs.
- A saved baseline in the dashboard.

Offer the existing Neon Auth methods:

- Continue with Google.
- Email magic link.

Use “Create Free Account” language and “No credit card” reassurance. Do not label this action as a paid trial unless the account lifecycle genuinely starts a time-limited paid-feature trial.

### Authenticated result

After authentication:

- Claim the anonymous scan for the authenticated account.
- Reveal the full report and Fix Pack access.
- Pre-fill onboarding using the scan's domain, industry, and region.
- Keep onboarding short and focused on the data required to create the first tracked brand.
- Open the dashboard on the existing completed report, not on a duplicate new scan.

If scan claiming fails, keep the user authenticated and provide a retry path. Do not strand the user on an empty dashboard.

## Application Architecture

### Server and client boundaries

- Convert `app/[lang]/page.tsx` into a Server Component for static marketing content and localized metadata.
- Move URL input, personalization, progress, and submission state into a focused client `ScanForm` component.
- Keep the result route as a Server Component that retrieves the scan and passes a minimal serializable view model to client interactions.
- Consolidate `EmailCaptureGate` and `TrialCta` into one account-unlock component instead of maintaining two sequential gates.
- Reuse existing score, impact, and issue components where their data contracts remain accurate.

### Scan ownership and auth continuation

- Carry the scan identifier through the supported auth callback `next` flow.
- Only an authenticated user may claim an unowned scan.
- Claiming is idempotent and must not overwrite a scan already owned by another account.
- Onboarding links the claimed scan and creates or reuses the first client record.
- Existing-user sign-in from the result page follows the same continuation and does not force new-account onboarding unnecessarily.

### Error handling

- Public scan: distinguish invalid URL, unreachable site, rate limit, timeout, and generic service failure.
- Auth: distinguish provider failure, delayed/expired magic link, too many attempts, and missing session.
- Claim: distinguish unauthenticated, already claimed, missing scan, and persistence failure.
- Onboarding: preserve input across retry and separate client creation from non-fatal prompt generation.
- Fix generation: keep the report usable when generation fails and offer retry.

Errors are localized, actionable, adjacent to the relevant control, and announced with `aria-live`.

## GEO/AEO/SEO Foundation

Add first-party, localized discovery assets:

- `app/robots.ts`
- `app/sitemap.ts`
- `app/llms.txt/route.ts` or an equivalent static public asset
- Locale-aware metadata for home, pricing, login, and public result routes
- `metadataBase`, canonical URLs, hreflang alternates, Open Graph, and Twitter cards
- Organization, WebSite, SoftwareApplication, and FAQ structured data where the rendered content supports each schema
- Correct `lang` on the localized document structure

Public result pages must avoid exposing gated details in metadata or structured data. The homepage copy and schema must describe capabilities accurately and avoid guarantees about third-party AI platforms.

## Pricing and Commercial Consistency

This pass does not invent a new commercial model. It must eliminate contradictory representations:

- Free account signup is the first funnel conversion.
- Plan identifiers, feature allowances, prices, and checkout eligibility come from one shared source of truth.
- If Basic is paid, remove “permanently free Starter” claims.
- If a free Starter tier is intended, render it consistently and do not send it to paid checkout.
- Enterprise either uses contact sales or self-serve checkout, not both.
- Pricing errors render once near the relevant action and preserve locale in success and cancel URLs.

Any unresolved business price decision is surfaced before changing production billing behavior.

## Localization

- Keep EN and `zh-HK` feature parity.
- Use concise Hong Kong business language for scan, signup, evidence, and fix actions.
- Preserve brand and platform names: Fimmick AISO, ChatGPT, Google AI, Perplexity, Claude, Gemini, Fix Pack.
- Format dates, numbers, and currency with `Intl` APIs.
- Add `translate="no"` to brand names, domains, code tokens, and platform identifiers where appropriate.
- Add tests that assert the critical funnel keys exist in both locales.

## Accessibility and Responsive Requirements

- Add a skip link and semantic header, nav, main, section, and footer landmarks.
- Give every form control a visible label, stable `name`, correct input type, and autocomplete behavior.
- Give disclosures `aria-expanded` and `aria-controls`.
- Maintain visible `focus-visible` treatment without `outline-none` gaps.
- Use buttons for actions and links for navigation.
- Keep touch targets at least 44px where practical.
- Announce progress, validation, auth, and unlock state changes.
- Respect `prefers-reduced-motion` for score and progress animation.
- Use status icon plus text, never color alone.
- Prevent horizontal page scroll at 375px; contain wide comparison data.
- Either complete public dark-mode token parity or keep public marketing pages explicitly light until parity exists.

## Measurement and Success Criteria

The implementation should expose stable event points for the project's analytics layer:

- `scan_started`
- `scan_succeeded`
- `scan_failed`
- `signup_started`
- `signup_magic_link_sent`
- `signup_completed`
- `scan_claimed`
- `report_unlocked`
- `onboarding_completed`

No new analytics vendor is introduced in this design. Event hooks must not block the user journey.

Primary funnel metrics:

- Hero scan-start rate.
- Scan completion rate.
- Completed-scan to signup-start rate.
- Signup-start to authenticated-account rate.
- Authenticated-account to completed-onboarding rate.

## Verification

### Automated

- Unit tests for URL normalization, claim state, localized metadata helpers, and content-source consistency.
- API tests for anonymous scan, auth continuation, scan claim, onboarding with an existing scan, and failure states.
- Component tests for accessible scan and signup forms.
- Playwright coverage for:
  - English anonymous scan -> inline signup -> auth continuation -> claimed report.
  - Traditional Chinese route parity.
  - Existing-user sign-in from a result.
  - Scan and auth recovery states.
- `npm test`, `npm run lint`, and `npm run build`.

### Visual and manual

- Verify 375px, 768px, 1024px, and 1440px widths.
- Keyboard-tab through nav, scan, personalization, signup, and result actions.
- Check reduced motion and public theme behavior.
- Confirm no duplicate scan is triggered after onboarding.
- Confirm the live `/robots.txt`, `/sitemap.xml`, and `/llms.txt` return 200.
- Confirm canonical, hreflang, Open Graph, and JSON-LD in deployed HTML.
- Run Fimmick AISO against its own deployment and document any checks that cannot pass for product-policy reasons.

## Scope Boundaries

In scope:

- Public homepage conversion hierarchy.
- Anonymous scan UX.
- Public result teaser and single account-unlock gate.
- Auth continuation, scan claiming, and onboarding continuity.
- Critical pricing/message consistency.
- EN/zh-HK funnel localization.
- GEO/AEO/SEO discovery assets.
- Accessibility, responsive, performance, and verification work on the touched funnel.

Out of scope unless required by verification:

- A full dashboard redesign.
- New scan checks or scoring weights.
- A new billing model or production price change.
- New paid infrastructure or analytics vendor.
- Replacing Neon Auth, the database, OpenRouter, or Stripe.
- Rebranding Fimmick AISO.

## Approved Outcome

The finished public journey should make one promise and keep it:

> Run a free scan, see credible evidence immediately, create a free account to unlock the complete action plan, and continue inside the product without losing the work already completed.
