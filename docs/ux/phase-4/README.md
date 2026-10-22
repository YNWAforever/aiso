# UX Phase 4: app shell and tasks

Evidence for the Phase 4 PR. "Before" is `main` at `9477b8d7` (Phases 1–3
merged); "after" is `ux/phase-4-app-shell`.

## What changed

- **Sidebar, five sections** from one model (`lib/dashboard-nav.ts`): Overview,
  Scan & Fix, Monitor, Reports, Settings. Monitor is hidden until Pulse is
  scheduled (`MONITOR_VISIBLE = false`); its pages still work by URL. The
  current section opens to show its pages.
- **Top bar**: brand switcher, breadcrumbs, search (⌘K / Ctrl+K), the existing
  notification bell, help menu. The palette loads on first use.
- **Tasks** (`/dashboard/[clientId]/tasks`, the only new URL): every work item
  with one status each — Draft, In review, Changes requested, Approved,
  Delivered — and a filter per status with counts. A row opens the existing
  review page (`work-items/[id]/versions`); a draft opens Opportunities.
  "Measured" stays on the detail page. One account- and brand-scoped query.
- **Overview**: a "Local visibility" card replaces the ROI sidebar entry;
  Monitor links are hidden. A next step that would open Monitor becomes
  "Run a new scan", so the header keeps exactly one action.
- No URL was removed, so no redirects were needed. Admin is unchanged.

## Screenshots

Offline fixtures of the real components with the production CSS, reduced
motion. Dashboard routes need a session, which the test server cannot create.

| | Before | After |
|---|---|---|
| Overview, en light, 390 / 1440 | `overview-en-light-{390,1440}-before.jpg` | `overview-en-light-{390,1440}-after.jpg` |
| Overview, zh-HK dark, 390 / 1440 | `overview-zh-dark-{390,1440}-before.jpg` | `overview-zh-dark-{390,1440}-after.jpg` |
| Tasks (new) | — | `tasks-{en,zh-HK}-{desktop,mobile}.png` |

Recording: `shell-interactions.webm` (⌘K search, brand switcher, help menu,
task filters), from a temporary hydrated page that was not committed.

## Performance

Lighthouse cannot load the dashboard (it needs a session), and no public page
changed. Instead, client JS per route from the two production builds
(`page_client-reference-manifest.js`, gzip):

PERF_TABLE

## Accessibility

`tests/e2e/app-shell.spec.ts` runs axe on the shell and task list (all states,
en and zh-HK, 375 and 1440, light and dark). It found one real issue, fixed
here: the active section's description at 80% opacity was 3.89:1.
