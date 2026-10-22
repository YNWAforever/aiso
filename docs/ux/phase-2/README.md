# UX Phase 2: landing page

Evidence for the Phase 2 PR. "Before" is `main` at `4e735bc0`; "after" is
`ux/phase-2-landing`. Screenshots are full-page with reduced motion (finished
frames). Recordings show the hero loop and the scroll reveals.

| | Before | After |
|---|---|---|
| en light, 1440 | `landing-en-light-1440-before.jpg` | `landing-en-light-1440-after.jpg` |
| en light, 390 | `landing-en-light-390-before.jpg` | `landing-en-light-390-after.jpg` |
| zh-HK dark, 1440 | `landing-zh-dark-1440-before.jpg` | `landing-zh-dark-1440-after.jpg` |
| zh-HK dark, 390 | `landing-zh-dark-390-before.jpg` | `landing-zh-dark-390-after.jpg` |

Recordings: `landing-desktop.webm` (1280×800), `landing-mobile.webm` (390×844).

## Lighthouse (`lighthouse.txt`)

Mobile preset, `next start`, 5 interleaved runs per side, medians. Chrome ran
with `--use-gl=swiftshader`: without it, headless Chrome in the CI container
drops frames until about 1.25 s on both sides, and Lighthouse's simulation then
counts every script and font as blocking first paint.

| Page | Perf before | Perf after | A11y | CLS |
|---|---|---|---|---|
| /en | 96 | 92 | 100 → 100 | 0 → 0 |
| /zh-HK | 92 | 90 | 100 → 100 | 0 → 0 |

`main` does not include Phase 1 (PR #101) yet, so the "before" side has no
Inter webfont. A build of this branch without Inter scored about 3 points
higher; the rest of the gap is a heavier document (87 KB vs 72 KB gzipped).
