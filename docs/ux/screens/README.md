# Screens (Phase 0 audit, 2026-10-22)

File names: `{locale}_{route}_{width}.jpg`. Widths 390 / 768 / 1440 px, full page, JPEG q70.

- `public/` — live production (`https://aiso-kappa.vercel.app`), anonymous. 28 routes × en/zh-HK × 3 widths.
  `/onboarding` and `/dashboard` redirect anonymous visitors to sign-in, so those shots show the login page.
  - `en_scan-progress-{0..5}_390.jpg` — the landing page during a real scan, ~1.5–5 s apart.
  - `{en,zh-HK}_result_{w}.jpg` — the anonymous result of that scan (`journey.json` has the timings).
- `signed-in-fixtures/` — authenticated components rendered from the repo's sanitized fixtures
  (`scripts/ci/prepare-component-fixtures.mjs`) with the production CSS build. Real components and fake data,
  **no dashboard shell** (sidebar and header). Slices: C8A workspace home, C8B portfolio, C8C Pulse,
  C8G settings, C9A entities, C9B observations, C9C opportunities (+ draft), C9D change-sets (+ approvers),
  C9E delivery, C9F outcomes, AISO_SOURCES, AISO_PRIORITY (check cards), PROMPT_BANK, AUTH_RETURN.
  Trimmed to representative states.
- `live-report.json` — per public URL: status, load time, overflow per width, rendered word count, headings,
  axe violations (WCAG 2.0/2.1/2.2 A+AA tags).
- `fixtures-report.json` — the same checks for all 124 fixture states (before trimming the images).
- `journey.json` — timed anonymous landing → first score run.
