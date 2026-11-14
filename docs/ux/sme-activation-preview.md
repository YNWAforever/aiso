# Controlled SME journey preview

This sample connects actual Today, draft, review, manual-delivery and stored-outcome components around fictitious Harbour Tea data. It supports inspecting work, submitting an exact sample revision, switching the sample reviewer view, recording a decision, and declaring one manual delivery. It does not authenticate users, grant permissions, persist business records, verify a website, contact providers or collect new outcome evidence. Package downloads and other application destinations are outside the sample and report that limitation explicitly.

The short participant tasks and blank observation table are in [the SME trial script](sme-activation-usability.md). **Human usability remains pending** until actual participant observations exist.

## Reproduce

Use the repository-required Node 24 runtime and a clean checkout of the revision recorded in the release receipt:

```sh
npm ci
npm run build
node scripts/sme-preview.mjs --output artifacts/sme-preview
```

The generator starts no server and requires no session, database or provider credential. Its default always combines CSS from the current production build. An explicit `--css PATH` can select an already verified build stylesheet.

Open either generated standalone file directly in a browser:

```text
artifacts/sme-preview/en-preview.html
artifacts/sme-preview/zh-HK-preview.html
```

Each file embeds its client runtime, messages, sample packets and stylesheet. It uses a restrictive content security policy and a closed in-memory fetch adapter, with no native network fallback. Reset returns to the initial draft. A read-failure selector and lost-reply button allow controlled recovery exercises. Use the sample instructions for the exact alternative revision and declared delivery time.

Only the supplied initial draft or exact alternative can become a frozen review offline. Arbitrary edits remain editable in the tab but receive an explicit sample limitation when submitted; an unrelated precomputed hash is never attached to them. Sample actor switching remounts the chosen view and is not a sign-in or permission check.

## Regression layers

| Layer | What it establishes | Limits |
| --- | --- | --- |
| Node scenario and transport tests | Real scan evidence → suggestion → canonical snapshot → work item → actual review freezer; normalized edits, replay/conflict identities, independent actor projections, active-event isolation, immediate outcome windows | Controlled state, not real session/SQL persistence |
| Continuous browser journey | Real Today anchor → real opportunities `?draft=` restoration → actual PATCH → native version navigation → Node freeze of the saved draft → independent reviewer context → history refresh → manual declaration → retained outcome read/reload | API transport is closed memory; it is not an authentication or production business-write test |
| Standalone browser journey | Actual components hydrate from the embedded file, sample roles share the same memory, manual declaration/reset work with zero outgoing HTTP requests | File mode uses internal hash navigation/direct DraftEditor; it does not claim real opportunities query restoration |
| Existing disposable integration gate | Real SQL constraints, tenancy and delivery/approval storage behavior against an approved disposable target | Separate from controlled UI and guarded production views |
| Canonical release checks | Exact merged deployment SHA, Ready/schema gate, approved guarded reads and layout/accessibility evidence | No production business mutations or human usability result |

The new browser matrix includes both locales/themes, widths 320/390/768/1440, desktop/mobile projects, keyboard navigation/focus, 44px controls, axe/reflow, unknown member reads, lost delivery acknowledgement, reconciliation and reload. Counts and results belong to the actual release receipt, not this design description.

CI prepares the new renderer with the existing fixture preparation command. To run the journey separately after preparing fixtures:

```sh
node scripts/ci/prepare-component-fixtures.mjs
C9J_HTML_DIR=.next/component-fixtures/C9J C9J_CSS_PATH=.next/component-fixtures/build.css E2E_FIXTURE_MODE=1 npx playwright test tests/e2e/sme-journey.spec.ts --project=chromium --project=mobile
```

The environment-prefix example uses a POSIX shell; set the same variables with `$env:NAME='value'` in PowerShell. The standalone generator is portable and needs no shell prefix. Avoid concurrent Playwright discovery/full unit runs while a browser run owns the default JSON report; preserve that report first.

## Evidence and boundaries

The manifest records artifact hashes, checkout SHA, package-lock hash, source hashes, client module-graph exclusions, genuine Node freezer witnesses, omitted Today peripherals and reproduction commands. Final release artifacts must be generated from the verified release checkout; a development artifact's base SHA alone does not establish the bytes of uncommitted edits.

Today is actual server-rendered BrandToday markup with the established translation seam. The omitted next/font layout variable uses local Arial, retaining the existing platform CJK fallback stack without external font requests; this is not exact Inter typography evidence. Peripheral ask/report/stats/chart/progress children are omitted from this bounded preview. The browser bundle rejects server-only, Node crypto, database and scenario-factory modules. A separate Node-only freezer bundle retains real crypto and uses a throwing database stub, so future accidental database calls fail closed. No production source or auth boundary is changed.

The sample clock follows submission, approval and declared delivery. A new declaration stays `self_reported`; its immediate outcome windows are not due and contain no later observation. It does not imply publication verification, a seven-day result or causal improvement.
