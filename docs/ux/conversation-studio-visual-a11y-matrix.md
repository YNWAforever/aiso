# Conversation Studio visual and accessibility matrix

Durable regression contract for shipped **Layout B**, Stages 0–5, B1/B2,
[KD1](conversation-studio-keep-dev-kd1.md) and
[KD2](conversation-studio-keep-dev-kd2.md). The
[KD3 delivery](conversation-studio-keep-dev-kd3.md) records validation and holds.
This is offline production-component fixture evidence. **Hosted Neon/Auth:
N/A / not run. Production FEATURE OFF remains untouched.**

## Required cells and acceptance

Every row covers all six existing views: **home, discussion, threads, documents,
connections, tools**. Discussion is an in-session state of `/studio`, not a new
route; the four READ views use existing `/studio/{view}` routes. Viewport height
is **1000 CSS px**; widths are CSS px, including in the Pixel 5 project. The
committed golden records Chromium; the same matrix runs in mobile.

| Locale | Width | Light | Dark |
| --- | ---: | --- | --- |
| en | 1440 | All 6 views | All 6 views |
| en | 900 | All 6 views | All 6 views |
| en | 390 | All 6 views | All 6 views |
| zh-HK | 1440 | All 6 views | All 6 views |
| zh-HK | 900 | All 6 views | All 6 views |
| zh-HK | 390 | All 6 views | All 6 views |

That is **72 required cells per project**. The
[golden numeric summary](studio-a11y/checks.json) records a fresh KD3 pass over all
72 Chromium cells at product revision `44aa1285b745772383a6ce72a156722250b6971b`.
Every recorded metric is zero.

| Acceptance | Measurement / proof |
| --- | --- |
| **0 axe serious/critical** | Whole-document `AxeBuilder.analyze()` per view. Existing tests require **zero violations at every impact**, which is stronger. Receipt keeps total, serious and critical counts separately. |
| No horizontal overflow | `document.documentElement.scrollWidth <= innerWidth` in every cell. Vertical shell scrolling is expected; captures do not imply that all content fits above the fold. |
| Text **≥12px** | Computed font size of rendered Studio elements with direct, nonempty text nodes; hidden nodes are excluded by the existing client-rect check. |
| Controls **≥44×44px** | Bounding boxes of rendered Studio `a, button, input, textarea, summary` elements, including disabled controls with nonzero geometry. |
| No unexpected requests | Fixture records and aborts every unexpected request. The receipt records a count, never request URLs or bodies. |
| Dashboard isolation unchanged | Existing `studio-shell.spec.ts` exit/navigation cases restore the real `DashboardChrome` and sidebar, remove `#aiso-studio` and clear temporary memory. KD3 leaves runtime files, global CSS and scoped Studio CSS byte-identical to base. |

These numeric checks measure rendered fixture states. They complement keyboard,
focus and visual review. Existing focused E2E also covers inspector open/close
and focus return, IME, mobile menu, KD1 toast/I5 exits, B2 explicit-send request
shape and cap-zero, KD2 context carry, per-thread drafts, brand/account changes
and reload isolation. The temporary brief is an interaction state, not a seventh
view. Optional screenshots also exercise its focused composer and announcement.

## Concept references and visual review

| Shipped view | Committed reference | Compare |
| --- | --- | --- |
| home | [01-home.webp](conversation-studio-concept/screenshots/01-home.webp) | Hero, composer, source/filter bars, task order and responsive columns. |
| discussion | [02-discussion.webp](conversation-studio-concept/screenshots/02-discussion.webp) | Question inset, scope/honesty badges, answer label, disclosure, result cards and follow-up composer. |
| threads | [03-threads.webp](conversation-studio-concept/screenshots/03-threads.webp) | Discussion hierarchy, arrows and explicit temporary-memory labels. |
| connections | [04-connections.webp](conversation-studio-concept/screenshots/04-connections.webp) | Separate binding, sync and completeness states; honest pending/disconnected copy. |
| documents / tools | [VIEWS](conversation-studio-concept/VIEWS.md), [concept snapshot](conversation-studio-concept/concept-inner.html) | Existing read-only metadata and tool catalogue; the supplied screenshot set has no corresponding images. |

All views also follow [TOKENS](conversation-studio-concept/TOKENS.md) and
[STRINGS](conversation-studio-concept/STRINGS.md). The four images are desktop
light mocks, **not responsive/dark pixel baselines**. Dark/mobile review uses
documented tokens and breakpoints. Real temporary/missing/unsupported states
replace mock bindings, saved outputs and results. No pixel-equality claim, new
view, IA change or Layout A is implied. Historical visual comparisons remain in
[Stage 5](conversation-studio-design-stage-5.md), KD1 and KD2 delivery records.

## Produce evidence locally

Use Node 24 and installed lockfile dependencies. On an ordinary local checkout,
produce production CSS with `npm run build`, then use the existing command:

```bash
node scripts/ci/prepare-component-fixtures.mjs
```

It reads `.next/static/chunks/*.css`, writes
`.next/component-fixtures/STUDIO/build.css`, and invokes component fixture tests,
including `__tests__/components/conversation-studio.test.tsx` and
`__tests__/components/studio-shell-fixture.test.tsx`. They bundle actual components
with only Next navigation/link transport replaced, without an application route
or auth bypass. See [development](../development.md) for build-validation limits;
do not call a failed production build a pass.

For Studio-only regeneration when `.next/component-fixtures/STUDIO/build.css`
already contains verified production CSS for the candidate:

```bash
TZ=UTC CI=1 STUDIO_HTML_DIR=.next/component-fixtures/STUDIO npm run test:unit -- \
  __tests__/components/conversation-studio.test.tsx \
  __tests__/components/studio-shell-fixture.test.tsx --maxWorkers=1
```

Run both existing focused browser specs. This fixture-only local command should
run with **CI and START_DEV_SERVER unset**: CI enables the repository's production
web server, which intercepted fixtures do not need. No env files are loaded.
Screenshots are optional; omit `STUDIO_STAGE5_SHOTS_DIR` for numeric proof only.

```bash
mkdir -p /workspace/cli-logs/aiso-kd3-shots
TZ=UTC E2E_FIXTURE_MODE=1 \
  STUDIO_HTML_DIR=.next/component-fixtures/STUDIO \
  STUDIO_STAGE5_SHOTS_DIR=/workspace/cli-logs/aiso-kd3-shots \
  PLAYWRIGHT_JSON_OUTPUT_NAME=/workspace/cli-logs/aiso-kd3.playwright-full.json \
  npm run e2e -- tests/e2e/conversation-studio.spec.ts tests/e2e/studio-shell.spec.ts \
  --project=chromium --project=mobile --workers=1 --reporter=list,json
```

`Studio screens …: reflow and axe` attaches one inline `studio-a11y-cell` JSON
measurement per view. With screenshots enabled, Chromium additionally captures
the temporary brief/composer (96 images total). Captures reset shell scroll and
hover. Keep screenshots, raw reports and traces outside git.

After a complete green run, promote only the numeric summary:

```bash
node scripts/a11y/studio-matrix.mjs \
  --report /workspace/cli-logs/aiso-kd3.playwright-full.json \
  --css .next/component-fixtures/STUDIO/build.css \
  --revision "$(git rev-parse HEAD)" \
  --output docs/ux/studio-a11y/checks.json
node scripts/a11y/studio-matrix.mjs --check
```

`--revision` identifies tested product source; use the actual candidate SHA.
KD3 records the base SHA because all runtime source is unchanged. CSS and raw
report SHA-256 hashes bind local inputs; hashes do not claim those ephemeral
inputs are retained in-repo. Refresh after relevant UI, CSS, translation or
fixture changes and review the diff. The checker validates the recorded receipt;
it does not rerun a browser or establish freshness against future changes.

## Sanitization and focused soft proof

[checks.schema.json](studio-a11y/checks.schema.json) is a closed JSON Schema v1:
fixed fixture metadata, SHA hashes, allowed dimensions and integer counts only.
There are no raw axe nodes/HTML/selectors, source URLs, prompts, account records,
cookies, timestamps or absolute artifact paths. Existing
[`lib/axe-report.ts`](../../lib/axe-report.ts) supports detailed sanitized axe
diagnostics; this receipt retains only counts.

The dependency-free checker enforces the schema's shape, all 72 unique Cartesian
cells and zero metrics. Promotion rejects failed, skipped or flaky reports,
retried matrix cases, missing measurements and partial matrices. Negative tests
are in `__tests__/e2e/studio-matrix.test.mjs`.

`node scripts/a11y/studio-matrix.mjs --check` is a dedicated, opt-in **soft proof**
command: exit 0 for a complete passing receipt; exit 1 with a diagnostic if the
schema/receipt is missing, malformed or records failures. No aggregate CI gate,
workflow or paid service is added. Existing Studio E2E retains its assertions.

Synthetic saved records and account changes prove presentation and session
memory only. Existing B2 sends are intercepted. **Hosted Neon/Auth, database
persistence, provider delivery and real tenant isolation are N/A / not run**,
outside KD3 authorization. Historical dashboard pixel comparisons remain labelled
in KD1/Stage 5; KD3 records unchanged source and rerun navigation isolation,
not a fresh hosted or pixel-diff claim.
