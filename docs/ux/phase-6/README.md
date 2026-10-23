# UX Phase 6: one-page report, PDF and share link

Evidence for the Phase 6 PR. "Before" is `main` at `c0216878` (Phases 1–5
merged); "after" is `ux/phase-6-reports`.

## What changed

- **One report component** (`components/reports/OnePageReport.tsx`) is the
  public share link (`/{lang}/r/{slug}`), the builder's review step and the
  public sample. It holds the score ring, the score trend, every check as a
  heatmap and the top three fixes, with the summary and method in a sentence
  each. It renders on the server; only the logo fallback, the reveal observer
  and the PDF button are client code.
- **Snapshot fields, no migration.** New report versions freeze two optional
  fields in the existing v1 snapshot: each check's evidence-backed verdict
  (the public result heatmap's rules, via `publicCheckAssessments`) and up to
  eight scores for the same account and domain. A trend point collected a
  different way from the one before is kept, dashed and labelled, so a method
  change never reads as progress or a drop. Versions published before this
  still open: the heatmap and trend say "not recorded" rather than drawing
  zeros. The dashboard parser, the service guard and the public resolver share
  one validator (`lib/reports/visuals.ts`).
- **Readable fixes.** Fixes the snapshot builder derived from the scan were
  stored as `Resolve failure: c1_robots`. They are now worded from the check
  catalogue in the reader's language, which also repairs versions already
  published. An agency's own recommendations are shown as written.
- **PDF.** "Download PDF" opens the browser's print window ("Save as PDF").
  The report lays out on one A4 page, prints light in either theme, and the
  dashboard and site chrome are hidden in print. No server rendering, no new
  dependency.
- **Share link** is unchanged: signed, versioned, revocable and rotatable.
- **Copy.** The public page's text moved from the page file into `messages/`
  (`reportPage`, en and zh-HK).

## Screenshots

Production build, the public sample (`/{lang}/sample-report`), full page,
reduced motion. The share link needs a published report in the database,
which the fixture server does not have; it renders the same component.

| | before / after |
|---|---|
| en, light | `sample-en-light-{390,1440}-{before,after}.jpg` |
| zh-HK, dark | `sample-zh-dark-{390,1440}-{before,after}.jpg` |
| PDF (A4, one page) | `sample-report-en.pdf`, `sample-report-zh.pdf`, `pdf-en-page.png` |

## Recordings

`report-desktop.webm` (1280×800, en, light) and `report-mobile-zh.webm`
(390×844, zh-HK, dark): scrolling the sample. The ring draws, the trend grows
in from the left and the heatmap tiles pop in as each card enters view.

## Lighthouse

Mobile, 5 runs each, production build on the fixture server,
`/{lang}/sample-report`. Median shown; every run is in the PR notes.

| | perf | a11y | LCP | TBT | CLS | JS |
|---|---|---|---|---|---|---|
| main en | 95 | 100 | 2.92 s | 60 ms | 0 | 168 KB |
| branch en | 95 | 100 | 2.93 s | 50 ms | 0 | 171 KB |
| main zh-HK | 97 | 100 | 2.47 s | 47 ms | 0 | 168 KB |
| branch zh-HK | 92 | 100 | 3.25 s | 54 ms | 0 | 171 KB |

The zh-HK LCP element is the report summary, whose paint lands later on a
document 8 KB larger (the report now carries the heatmap, trend and fixes).

A first version used the motion-based ring and heatmap and cost +81 KB of JS
and about 4 performance points; switching to the server-rendered reveal
versions brought that back to +3 KB.

Client JS per route (entry chunks, gzip): sample +9 KB, share link +9 KB,
report builder +18 KB (it renders the report on the client, check copy
included).

## Accessibility

- `tests/e2e/c8e-sample-report.spec.ts` runs axe on the sample in en and zh-HK,
  at 375 and 1440, light and dark, with no horizontal scroll. It also prints
  the sample and requires exactly one A4 page.
- The trend has a visually hidden table of every point, the heatmap tiles carry
  their check and status in text, and the ring has one sentence as its name.

## Risks

- A very long summary (up to 1,200 characters) or long agency-written fixes can
  push the PDF to a second page. Cards are kept whole across the break.
- Reports published before this PR show no heatmap or trend until a new version
  is published.
