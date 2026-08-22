# Delete Superseded Orphaned Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the 4 components `__tests__/components/orphaned-components.test.ts` marks as
"superseded" (dead code with a live replacement, as opposed to the other 7 entries in that
inventory, which are legitimately fenced pending restore), and re-point the one test that
still reads a superseded component's source instead of its replacement.

**Architecture:** No new code. `components/dashboard/WizardProgress.tsx`,
`components/dashboard/PlanGate.tsx`, `components/CheckItem.tsx`, and
`components/SaveScanButton.tsx` have zero real importers anywhere in the app (confirmed via
`import ... from` grep, not filename substring matching) — their replacements
(`DashboardSidebar.tsx`'s step switch, `LockedFeature`, `ResultClient`'s inline check
rendering, and the scan-claim funnel routes) already exist and are already live. One test,
`__tests__/components/local-trust.test.tsx`'s `'keeps Local Trust ROI visible but locked for
plans without access'`, currently pins that invariant against `WizardProgress.tsx`'s source
and must be re-pointed at `DashboardSidebar.tsx` — the file that actually renders it — before
`WizardProgress.tsx` can be deleted, so no coverage is lost.

**Tech Stack:** Vitest (`vitest run`), TypeScript, no runtime dependencies touched.

---

### Task 1: Re-point the Local Trust ROI test to its live implementation

This is not new functionality — `DashboardSidebar.tsx` already renders the `roi` nav entry
gated by `features.local_trust_roi` with a `Lock` icon. This task only changes which file the
test reads, so the updated assertions should pass immediately, before anything is deleted.

**Files:**
- Modify: `__tests__/components/local-trust.test.tsx:76-84`

- [ ] **Step 1: Replace the test body**

In `__tests__/components/local-trust.test.tsx`, replace lines 76-84:

```ts
  it('keeps Local Trust ROI visible but locked for plans without access', () => {
    const progress = read('components/dashboard/WizardProgress.tsx')

    expect(progress).toContain("key: 'roi'")
    expect(progress).toContain('features.local_trust_roi')
    expect(progress).toContain('Local Trust ROI')
    expect(progress).toContain('Lock')
    expect(progress).not.toContain('🔒')
  })
```

with:

```ts
  it('keeps Local Trust ROI visible but locked for plans without access', () => {
    // WizardProgress duplicated this and was deleted (2026-08-22 orphan
    // cleanup) — DashboardSidebar is the live implementation of the roi step.
    const sidebar = read('components/dashboard/DashboardSidebar.tsx')

    expect(sidebar).toContain("key: 'roi'")
    expect(sidebar).toContain('features.local_trust_roi')
    expect(sidebar).toContain('<Lock')
    expect(sidebar).not.toContain('🔒')
  })
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/local-trust.test.tsx`
Expected: PASS, including `'keeps Local Trust ROI visible but locked for plans without access'`

- [ ] **Step 3: Commit**

```bash
git add __tests__/components/local-trust.test.tsx
git commit -m "test: re-point the Local Trust ROI check at DashboardSidebar, not the dead WizardProgress"
```

---

### Task 2: Delete WizardProgress.tsx

Safe now that Task 1 removed the last reader of its source. Its `ORPHANS` entry is removed in
the same task since the entry and the file are the same fact.

**Files:**
- Delete: `components/dashboard/WizardProgress.tsx`
- Modify: `__tests__/components/orphaned-components.test.ts:34-39`

- [ ] **Step 1: Delete the file**

```bash
rm components/dashboard/WizardProgress.tsx
```

- [ ] **Step 2: Remove its ORPHANS entry**

In `__tests__/components/orphaned-components.test.ts`, remove this block (the comment and the
entry together, including the blank line that follows it):

```ts
  // Superseded rather than fenced. The dashboard page renders its own step
  // switch and the sidebar links all five steps again, so WizardProgress now
  // duplicates both. Two assertions in local-trust.test.tsx read its source, so
  // it cannot be deleted without deciding what those should pin instead.
  'dashboard/WizardProgress': 'superseded by the dashboard page step switch',

```

so that the `ORPHANS` map reads (unchanged parts elided with `...`):

```ts
const ORPHANS: Record<string, string> = {
  // Pulse read surface. ...
  'pulse/ScanLogSection': 'renders the weekly scan log; its data routes are deleted',
  'pulse/CompetitorTab': 'competitor view for the deleted Pulse read routes',
  'dashboard/PulseTabs': 'tab chrome for the fenced standalone Pulse page',
  // Reachable only through the three above, so orphaned with them. ...
  'pulse/CompetitorChart': 'only rendered by the orphaned CompetitorTab',
  'pulse/QuestionRow': 'only rendered by the orphaned ScanLogSection',
  'pulse/PlatformBar': 'only rendered by the orphaned Pulse read surface',

  'dashboard/PlanGate': 'entitlement wrapper superseded by LockedFeature',
  'CheckItem': 'superseded by the result page check rendering',
  'SaveScanButton': 'superseded by the scan-claim funnel',
}
```

(Leave the existing comments on the Pulse entries exactly as they are — only the
`WizardProgress` block is removed in this step.)

- [ ] **Step 3: Run the affected tests to verify they still pass**

Run: `npx vitest run __tests__/components/orphaned-components.test.ts __tests__/components/local-trust.test.tsx`
Expected: PASS. `orphaned-components.test.ts` passes because the deleted file is no longer
returned by `componentFiles()`, so it can't appear in `unlisted` or become `stale`.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/WizardProgress.tsx __tests__/components/orphaned-components.test.ts
git commit -m "refactor: delete WizardProgress, superseded by the dashboard step switch"
```

---

### Task 3: Delete PlanGate.tsx, CheckItem.tsx, and SaveScanButton.tsx

None of these three has any test reading their source beyond the `ORPHANS` inventory itself
(confirmed: no `import` of any of them exists outside their own file), so they can be deleted
together in one task.

**Files:**
- Delete: `components/dashboard/PlanGate.tsx`
- Delete: `components/CheckItem.tsx`
- Delete: `components/SaveScanButton.tsx`
- Modify: `__tests__/components/orphaned-components.test.ts:40-42` (as renumbered after Task 2)

- [ ] **Step 1: Delete the three files**

```bash
rm components/dashboard/PlanGate.tsx components/CheckItem.tsx components/SaveScanButton.tsx
```

- [ ] **Step 2: Remove their ORPHANS entries**

After Task 2, the end of the `ORPHANS` map reads:

```ts
  'pulse/PlatformBar': 'only rendered by the orphaned Pulse read surface',

  'dashboard/PlanGate': 'entitlement wrapper superseded by LockedFeature',
  'CheckItem': 'superseded by the result page check rendering',
  'SaveScanButton': 'superseded by the scan-claim funnel',
}
```

In `__tests__/components/orphaned-components.test.ts`, remove the blank line and the three
entry lines after `'pulse/PlatformBar': ...,` — everything from the blank line through
`'SaveScanButton': ...,` inclusive — so the full `ORPHANS` map now reads exactly:

```ts
const ORPHANS: Record<string, string> = {
  // Pulse read surface. Kept as the only implementation of this UI, though a
  // rebuild would need new data routes — summary/missed were deleted, not
  // fenced, in the 2026-08-22 pulse-fence cleanup (see CLAUDE.md).
  'pulse/ScanLogSection': 'renders the weekly scan log; its data routes are deleted',
  'pulse/CompetitorTab': 'competitor view for the deleted Pulse read routes',
  'dashboard/PulseTabs': 'tab chrome for the fenced standalone Pulse page',
  // Reachable only through the three above, so orphaned with them. A check that
  // asked "does anything import this" would have called all three live.
  'pulse/CompetitorChart': 'only rendered by the orphaned CompetitorTab',
  'pulse/QuestionRow': 'only rendered by the orphaned ScanLogSection',
  'pulse/PlatformBar': 'only rendered by the orphaned Pulse read surface',
}
```

- [ ] **Step 3: Run the orphan test to verify it passes**

Run: `npx vitest run __tests__/components/orphaned-components.test.ts`
Expected: PASS, with `ORPHANS` now holding exactly the 6 Pulse entries.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/PlanGate.tsx components/CheckItem.tsx components/SaveScanButton.tsx __tests__/components/orphaned-components.test.ts
git commit -m "refactor: delete PlanGate, CheckItem, and SaveScanButton, each superseded by a live replacement"
```

---

### Task 4: Full verification sweep

Confirms nothing outside the grep-checked `import ... from` statements (e.g. a dynamic
import, a type-only reference, or a stale doc link) still depends on any of the 4 deleted
files, and that the rest of the suite is unaffected.

**Files:** none (verification only — no changes expected)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, same pass count as before this plan minus nothing (no tests were removed,
one was rewritten in place).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: `0 errors, 0 warnings`. If a dangling import surfaces here that the grep in Task 1-3
missed, fix that specific import in its file and re-run this step before proceeding — do not
proceed to Step 3 with a lint failure.

- [ ] **Step 3: Run the type checker**

Run: `npm run typecheck`
Expected: no errors. `__tests__` is excluded from this command per this repo's
`tsconfig.json`, so it only catches a stray reference from application code, not from a test
file — Steps 1-2 are what actually guard the test files.

- [ ] **Step 4: Confirm no leftover reference to any of the 4 deleted components**

Run:
```bash
grep -rn "WizardProgress\|PlanGate\|CheckItem\|SaveScanButton" app components lib __tests__ 2>/dev/null
```
Expected: no output. (`ExpandableCheckItem` in `components/ExpandableCheckItem.tsx` is a
different, unrelated component — if it appears here, confirm it's matching on the substring
`CheckItem` inside that unrelated name, not a real reference to the deleted file, before
treating it as a problem.)

No commit for this task — it is verification only. If any step required a fix, that fix was
already committed as part of its own step above.
