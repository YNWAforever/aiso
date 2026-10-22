# UX Phase 3: scan progress and result

Evidence for the Phase 3 PR. "Before" is `main` at `2bfeaf36` (Phases 1 and 2
merged); "after" is `ux/phase-3-scan-result`. Screenshots are full-page with
reduced motion (finished frames).

## Screenshots

Same fixture on both sides (`e2e…0001`, whose checks have no collection
evidence, so every check reads "not checked"):

| | Before | After |
|---|---|---|
| en light, 390 / 1440 | `result-en-light-{390,1440}-before.jpg` | `result-en-light-{390,1440}-after.jpg` |
| zh-HK dark, 390 / 1440 | `result-zh-dark-{390,1440}-before.jpg` | `result-zh-dark-{390,1440}-after.jpg` |

After only, on the fixture with complete evidence (`e2e…0100`, added in this
phase): `result-assessed-*.jpg`, and the check drawer in `drawer-en-{390,1440}.jpg`.

Recordings: `scan-to-result-{desktop,mobile}.webm` (live checklist while the
scan runs, the result revealing, a heatmap tile opening the drawer).

## Lighthouse (`lighthouse.txt`)

Mobile preset, `next start`, 7 interleaved runs per side, medians, Chrome with
`--use-gl=swiftshader` (see docs/ux/phase-2/README.md for why).

| Page | Perf before | Perf after | A11y | CLS | Script (transfer) |
|---|---|---|---|---|---|
| /en/result/… | 83 | **90** | 100 → 100 | 0 → 0 | 547 → 320 KB |
| /zh-HK/result/… | 82 | **83** | 100 → 100 | 0 → 0 | 547 → 320 KB |
| /en (landing) | 94 | 91 | 100 → 100 | 0 → 0 | 164 → 166 KB |

The zh-HK result is below 90 on both sides. Most runs that miss do so because
headless Chrome delays the first paint (observed LCP ≈ 1.3 s instead of
≈ 0.3 s), which happens more often on CJK pages; the rest is the auth client
the free-account card needs (about 100 KB gzipped), which `main` ships too.
The landing difference is within run-to-run spread (91–96 vs 91–96).
