# UX Phase 7: microinteractions and quality

Evidence for the Phase 7 PR. "Before" is `main`; "after" is
`ux/phase-7-quality`.

## What changed

- **Microinteractions**
  - One copy button (`components/ui/copy-button.tsx`): the icon pops to a
    check, the label reads "Copied" for two seconds, the status is announced
    once, and a failure is shown instead of swallowed. Used for share links in
    the report builder and list and for code in the fix drawer.
  - Toasts for finished actions in the report builder (save, publish, AI
    summary, copy, rotate, revoke); loading, warnings and errors stay inline.
    The provider is mounted in the dashboard layout.
  - Buttons press in slightly; clickable cards share one hover/focus utility
    (`card-interactive`: lift 2 px and the e2 shadow, ring on focus, no
    movement with reduced motion). Transform, opacity and shadow only.
- **WCAG 2.2 AA** (`tests/e2e/a11y/wcag22.spec.ts`)
  - Target size (2.5.8) on the public pages. axe ships this rule disabled,
    so the existing matrix never ran it; every page passes.
  - Reflow at 320 px and at 200% zoom of a 1280 px window.
  - Keyboard: the mobile menu, dialogs and the command palette take focus,
    keep it while open and return it. **Fixed:** the command palette sent
    focus to `<body>` when closed, because it opens without a Radix Trigger;
    it now returns focus to whatever opened it.
- **Lighthouse CI** (`lighthouserc.cjs`, run in the `build` job): seven public
  pages, three runs each. Blocking: accessibility 100, CLS ≤ 0.1, and a
  JavaScript budget per page. Warning only: performance score, LCP, TBT.
- **E2E journeys** (`tests/e2e/journeys.spec.ts`, desktop and mobile, en and
  zh-HK): home → scan → result → open the top fix → free-account prompt;
  pricing → plan → sign in; sample report → Download PDF. Each asserts the
  funnel events sent, and that they carry no URL, email or results.
  Signed-in pages cannot run in CI (no session), so the report review and its
  PDF are covered offline by `tests/e2e/report-print.spec.ts`.
- **Funnel events** (same redacted fields as before): `fix_opened`,
  `report_published`, `report_link_copied`, `report_pdf_downloaded`,
  `upgrade_prompt_viewed`, `upgrade_prompt_clicked`, `onboarding_completed`.
- **Text audit** (`npm run audit:text`, in the `static` job): fails on
  hardcoded UI text (including per-language copy objects and
  `lang === 'zh-HK' ? … : …` strings), catalogue drift (keys and ICU
  arguments), zh-HK values still in English, and claims the product cannot
  back ("guarantees", "was cited", "rank #1"; negations pass). Exceptions sit
  in `scripts/text-audit-allowlist.json`, each with its reason. The first run
  found 377 strings in 29 files; all moved to `messages/` in both languages
  with the wording unchanged. Admin and dev pages are excluded by decision.
  Product-name spellings are counted, not enforced, for Phase 8.
- **Report print (carried from #106):** the longest report a user can write
  (1,200-character summary and three 1,200-character recommendations) now
  prints on one A4 page in both languages. Print puts score, trend and
  heatmap in one row and the fixes full width; the scale follows the amount
  of text, calibrated against real PDFs with at least 0.06 of headroom (CI
  runners set text slightly larger than a laptop). Past the last step the
  scale stops at a readable 68% and only an agency's recommendations are cut
  in print, to 8 lines plus 3 for the next step, with a note that the online
  report has the full text. A recommendation stored as both rationale and
  next step now prints once.

## Evidence

| | |
|---|---|
| Copy migration changed no pixels | `login-390-{before,after}.jpg`, `result-390-{before,after}.jpg` (zh-HK; identical, as were 1440 and onboarding) |
| Interactions | `interactions-desktop.webm`: copy press and check, toast, palette open, type, Escape with focus back |
| Longest report, one A4 page | `report-longest-en.pdf`, `report-longest-zh.pdf` (was 2–3 pages) |
| Share image now follows the language | `share-image-zh.png` (was English on zh-HK result links) |
| Text audit output | `text-audit.json` (clean; product names counted) |

## Lighthouse (mobile, fixture server, median of 3)

| Page | perf | a11y | LCP | CLS | JS (budget) |
|---|---|---|---|---|---|
| /en | 93 | 100 | 3.09 s | 0 | 166 KB (200) |
| /zh-HK | 91 | 100 | 3.30 s | 0 | 166 KB (200) |
| /en/pricing | 96 | 100 | 2.45 s | 0 | 174 KB (200) |
| /en/scan | 95 | 100 | 2.42 s | 0 | 174 KB (220) |
| /en/sample-report | 97 | 100 | 2.50 s | 0 | 171 KB (200) |
| /zh-HK/sample-report | 92 | 100 | 3.25 s | 0 | 171 KB (200) |
| /en/result (fixture) | 83 | 100 | 3.95 s | 0 | 318 KB (380) |

## Verification

- `npm run lint`, `npm run typecheck`, `npm run audit:text`: clean.
- `npm run test:unit`: 472 files, 6,483 tests pass.
- Full Playwright suite against the production build with the CI component
  fixtures: 1,572 passed, 56 skipped (environment-gated suites).
