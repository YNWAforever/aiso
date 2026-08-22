# Delete Superseded Pulse Fences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the three `pulse/*` routes CLAUDE.md already says are superseded rather than fenced (`pulse/onboard`, `pulse/[clientId]/summary`, `pulse/[clientId]/missed`), instead of leaving them as permanent 503 stubs — and correct the two docs that reference them.

**Architecture:** Pure deletion, no new behavior. Three route files go, their `fenced-routes.test.ts` entries go with them (including a comment that becomes dangling once they're all removed), `CLAUDE.md` is updated to stop listing them as fenced and to record they were deleted, and one comment in `orphaned-components.test.ts` is corrected because it currently justifies keeping six UI components orphaned by pointing at a possibility (restoring the standalone Pulse page via these exact routes) that these deletions permanently close off. Per explicit decision, those six components themselves are **not** deleted — only their stated reason changes.

**Tech Stack:** TypeScript 5.9, Next.js 16 App Router (file-based route deletion), Vitest 4.

**Design doc:** `docs/superpowers/specs/2026-08-22-delete-superseded-pulse-fences-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/api/pulse/onboard/route.ts` | Fence stub for a superseded route | Delete |
| `app/api/pulse/[clientId]/summary/route.ts` | Fence stub for a superseded route | Delete |
| `app/api/pulse/[clientId]/missed/route.ts` | Fence stub for a superseded route | Delete |
| `app/api/pulse/[clientId]/` | Directory, empty once both files above are gone | Delete (directory) |
| `__tests__/api/fenced-routes.test.ts` | Canonical fenced-route inventory | Modify (remove 3 entries + a now-dangling comment) |
| `CLAUDE.md` | Auth Architecture section | Modify (fenced list + settled-deletion note) |
| `__tests__/components/orphaned-components.test.ts` | Orphan inventory with reasons | Modify (comment only — no `ORPHANS` keys added or removed) |

**Commands** (from the repo root):

```bash
npx vitest run __tests__/path/to/file.test.ts
```

```bash
npm run lint && npm run typecheck
```

Baseline before this plan: **147 files / 1624 tests** pass; lint and typecheck are clean.

---

### Task 1: Delete the three route files and their fenced-routes test entries

**Files:**
- Delete: `app/api/pulse/onboard/route.ts`
- Delete: `app/api/pulse/[clientId]/summary/route.ts`
- Delete: `app/api/pulse/[clientId]/missed/route.ts`
- Modify: `__tests__/api/fenced-routes.test.ts`

These two changes are done together because leaving either half undone breaks the suite: deleting only the routes leaves `fenced-routes.test.ts` importing three files that no longer exist (`await import(path)` throws `Cannot find module`); deleting only the test entries first would leave three stub routes with no test coverage for a moment, which is harmless but pointless to sequence separately.

- [ ] **Step 1: Confirm nothing else references these three routes before deleting**

Run:

```bash
grep -rn "pulse/onboard\|pulse/\[clientId\]/summary\|pulse/\[clientId\]/missed" --include="*.ts" --include="*.tsx" app lib components __tests__
```

Expected: only hits inside `__tests__/api/fenced-routes.test.ts` itself (the three entries being removed in Step 3) and the three route files themselves. If anything else references these paths, stop and report it — the design doc's own search found nothing, but re-verify against the current tree rather than trusting that finding blindly.

- [ ] **Step 2: Delete the three route files**

```bash
rm "app/api/pulse/onboard/route.ts"
rm "app/api/pulse/[clientId]/summary/route.ts"
rm "app/api/pulse/[clientId]/missed/route.ts"
```

Then remove the now-empty directory:

```bash
rmdir "app/api/pulse/[clientId]"
```

If `rmdir` fails because the directory isn't empty, stop — that means something under it wasn't accounted for in Step 1, and needs investigating before continuing.

- [ ] **Step 3: Remove the three entries and their now-dangling comment from `fenced-routes.test.ts`**

Current content of the `FENCED` array's start:

```ts
const FENCED: { path: string; feature: string; methods: string[] }[] = [
  { path: '@/app/api/pulse/onboard/route', feature: 'pulse', methods: ['POST'] },
  // pulse/run is restored — see __tests__/api/pulse-run.test.ts. The rest of
  // Pulse stays fenced: they are read routes with no producer-side work done.
  { path: '@/app/api/pulse/[clientId]/summary/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/pulse/[clientId]/missed/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/fix/cluster-map/route', feature: 'content-tools', methods: ['POST'] },
```

Replace with:

```ts
const FENCED: { path: string; feature: string; methods: string[] }[] = [
  { path: '@/app/api/fix/cluster-map/route', feature: 'content-tools', methods: ['POST'] },
```

The two-line comment must go too, not just the three `path` entries — it explains why Pulse routes "stay fenced," and after this task there are zero Pulse entries left anywhere in `FENCED`, so a comment framed around "the rest of Pulse" would describe nothing.

Read the file first to confirm this is still the exact current text before editing — if it has drifted (another branch may have touched this file), report the actual current content rather than guessing at how to reconcile it.

- [ ] **Step 4: Run the fenced-routes test to verify it still passes**

Run: `npx vitest run __tests__/api/fenced-routes.test.ts`

Expected: PASS, with 3 fewer test cases than before (each `FENCED` entry generates one `it()` per HTTP method). This file no longer asserts anything about `pulse/onboard`, `pulse/[clientId]/summary`, or `pulse/[clientId]/missed` — because those routes no longer exist to assert against.

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`

Expected: PASS, with exactly 3 fewer tests than baseline (147 files / 1621 tests — same file count, since no test *file* was deleted, only entries within one). If the file count also drops, something removed more than intended; investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add "app/api/pulse/onboard/route.ts" "app/api/pulse/[clientId]/summary/route.ts" "app/api/pulse/[clientId]/missed/route.ts" __tests__/api/fenced-routes.test.ts
git commit -m "chore(pulse): delete the three superseded fence stubs"
```

Note: `git add` on deleted files stages the deletion — this is correct, not an error. Confirm with `git status --short` that the three route files show as `D` (deleted) and `fenced-routes.test.ts` shows as `M` (modified) before committing.

---

### Task 2: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove `pulse/onboard` and `pulse/[clientId]/*` from the fenced-routes list**

Find this block (Auth Architecture section):

```markdown
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `pulse/onboard`, `pulse/[clientId]/*`, `fix/cluster-map`, `fix/content-brief`,
> `notifications/*`, `agents/*`, `cron/trial-emails`. **Local
> Trust, the alerts *config* route, the Pulse producer (`pulse/run`), the whole prompt bank
> and `pulse/suggest-questions` are restored**. `cron/evaluate-alerts` is now Neon-backed
```

Replace it with:

```markdown
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `fix/cluster-map`, `fix/content-brief`,
> `notifications/*`, `agents/*`, `cron/trial-emails`. **Local
> Trust, the alerts *config* route, the Pulse producer (`pulse/run`), the whole prompt bank
> and `pulse/suggest-questions` are restored**. `cron/evaluate-alerts` is now Neon-backed
```

Before editing, run `grep -n "Routes whose feature is fenced" CLAUDE.md` and confirm the surrounding text still matches what's shown above — if it has drifted, report the actual current text rather than blindly applying a stale diff.

- [ ] **Step 2: Mark the deletion decision as executed, not just decided**

Find:

```markdown
> Three of the remaining fences should be **deleted rather than restored**, and it is worth
> not re-litigating that: `pulse/[clientId]/summary` and `/missed` are redundant —
> `clients/[clientId]/overview` is unfenced and already serves both datasets with larger
> limits — and `pulse/onboard` is superseded by `onboarding/complete`.
```

Replace it with:

```markdown
> Three fences **were deleted rather than restored** (2026-08-22): `pulse/[clientId]/summary`
> and `/missed` were redundant — `clients/[clientId]/overview` is unfenced and already serves
> both datasets with larger limits — and `pulse/onboard` was superseded by
> `onboarding/complete`. All three route files, and their entries in
> `__tests__/api/fenced-routes.test.ts`, are gone.
```

Before editing, run `grep -n "Three of the remaining fences" CLAUDE.md` and confirm the surrounding text matches — report any drift rather than guessing.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(pulse): record the three superseded fences as deleted"
```

---

### Task 3: Correct the orphaned-Pulse-UI comment

**Files:**
- Modify: `__tests__/components/orphaned-components.test.ts`

**No `ORPHANS` keys are added or removed in this task** — per the design's explicit decision, all six Pulse UI components stay listed exactly as they are. Only the comment above them changes, because it currently justifies keeping them by pointing at a possibility this plan's Task 1 permanently closes off.

- [ ] **Step 1: Read the current comment and confirm it matches**

Find, near the top of the `ORPHANS` object:

```ts
const ORPHANS: Record<string, string> = {
  // Pulse read surface. The routes feeding these return 503, and CLAUDE.md
  // records summary/missed as redundant against clients/[clientId]/overview.
  // Kept because restoring the standalone /pulse page is still on the table.
  'pulse/ScanLogSection': 'renders the weekly scan log; its route is fenced',
  'pulse/CompetitorTab': 'competitor view for the fenced Pulse read routes',
  'dashboard/PulseTabs': 'tab chrome for the fenced standalone Pulse page',
  // Reachable only through the three above, so orphaned with them. A check that
  // asked "does anything import this" would have called all three live.
  'pulse/CompetitorChart': 'only rendered by the orphaned CompetitorTab',
  'pulse/QuestionRow': 'only rendered by the orphaned ScanLogSection',
  'pulse/PlatformBar': 'only rendered by the orphaned Pulse read surface',
```

Before editing, run `grep -n "restoring the standalone /pulse page is still on the table" __tests__/components/orphaned-components.test.ts` and confirm this text is still present. If it has drifted, report the actual current content rather than guessing at how to reconcile it.

- [ ] **Step 2: Replace the three-line comment**

Replace just the comment (all six `'key': 'value'` lines and their own inline comment stay exactly as they are):

```ts
const ORPHANS: Record<string, string> = {
  // Pulse read surface. Kept as the only implementation of this UI, though a
  // rebuild would need new data routes -- summary/missed were deleted, not
  // fenced, in the 2026-08-22 pulse-fence cleanup (see CLAUDE.md).
  'pulse/ScanLogSection': 'renders the weekly scan log; its route is fenced',
  'pulse/CompetitorTab': 'competitor view for the fenced Pulse read routes',
  'dashboard/PulseTabs': 'tab chrome for the fenced standalone Pulse page',
  // Reachable only through the three above, so orphaned with them. A check that
  // asked "does anything import this" would have called all three live.
  'pulse/CompetitorChart': 'only rendered by the orphaned CompetitorTab',
  'pulse/QuestionRow': 'only rendered by the orphaned ScanLogSection',
  'pulse/PlatformBar': 'only rendered by the orphaned Pulse read surface',
```

Note the individual reason strings on the `'pulse/ScanLogSection'`, `'pulse/CompetitorTab'`, and `'dashboard/PulseTabs'` lines still say "its route is fenced" / "the fenced Pulse read routes" / "the fenced standalone Pulse page" — these are now slightly inaccurate too (the routes are deleted, not fenced), but they are **out of scope for this step**: changing them means touching six separate `Record` values, each of which the file's own test (see Step 4 below) only checks for length, not content — leave them as-is. The block comment is the one making an affirmative claim about restoration being "on the table," which is the one this task exists to correct.

- [ ] **Step 3: Run the test to verify it still passes**

Run: `npx vitest run __tests__/components/orphaned-components.test.ts`

Expected: PASS, same test count as before (this file's assertions check structural properties — reachability and reason-string length — not the comment's content, so a comment-only change cannot fail it; passing here confirms the file still parses and the six `ORPHANS` keys are untouched).

- [ ] **Step 4: Full verification**

```bash
npm run test:unit
npm run lint
npm run typecheck
```

Expected: lint 0 errors / 0 warnings, typecheck exit 0, unit suite green at **147 files / 1621 tests** (baseline 147/1624, minus the 3 removed `fenced-routes.test.ts` cases from Task 1 — Task 3 changes a comment only, so it adds or removes no tests).

- [ ] **Step 5: Commit**

```bash
git add __tests__/components/orphaned-components.test.ts
git commit -m "docs(pulse): correct the orphaned-UI comment now that summary/missed are gone"
```

---

## What this plan deliberately does not do

- **Does not delete the six orphaned Pulse UI components** (`pulse/ScanLogSection`, `pulse/CompetitorTab`, `dashboard/PulseTabs`, `pulse/CompetitorChart`, `pulse/QuestionRow`, `pulse/PlatformBar`). Per explicit decision, they remain the only implementation of that UI; only the block comment explaining why they're orphaned changes.
- **Does not touch the six components' individual reason strings** (Task 3, Step 2's note) — only their shared block comment, which is the one asserting something no longer true.
- **Does not touch `pulse/run`, `pulse/suggest-questions`, or any other already-restored Pulse route.**
- **Does not modify `clients/[clientId]/overview` or `onboarding/complete`** — both already exist and already do the superseding work.
- **Does not add any new test.** Deleting a 503 stub removes behavior, it doesn't add any to verify; the shrunk `fenced-routes.test.ts` assertion set is itself the verification that the routes are gone.
