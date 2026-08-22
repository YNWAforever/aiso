# Delete Superseded Orphaned Components Design

**Goal:** Delete the 4 components `__tests__/components/orphaned-components.test.ts` already
identifies as **superseded** — dead code with a real, live replacement, as opposed to the
other 7 entries in that same inventory, which are legitimately fenced or orphaned pending a
restore decision. Re-point the one test that still asserts against a superseded component's
source instead of its replacement, so no coverage is lost in the deletion.

**Context:** `__tests__/components/orphaned-components.test.ts` is a deliberate inventory,
not a generic dead-code scanner — it fails both when a new orphan appears with no entry and
when a listed one becomes reachable again. Its `ORPHANS` map currently carries 10 entries.
6 are the Pulse read surface (kept: "the only implementation of this UI," restoring the
standalone `/pulse` page would need new data routes since `summary`/`missed` were deleted in
the 2026-08-22 pulse-fence cleanup — out of scope here). The remaining 4 are annotated
`superseded by <X>`, where `<X>` already exists and is already live:

| Component | Superseded by |
|---|---|
| `components/dashboard/WizardProgress.tsx` | the dashboard page's own step switch + `DashboardSidebar.tsx` |
| `components/dashboard/PlanGate.tsx` | `LockedFeature` |
| `components/CheckItem.tsx` | `ResultClient`'s inline check rendering |
| `components/SaveScanButton.tsx` | the scan-claim funnel (`scans/[id]/claim`, `claim-intent`) |

Confirmed by grepping for actual `import ... from` statements (not filename substring
matches, which false-positive on e.g. `ExpandableCheckItem`): none of the 4 files are
imported anywhere outside their own definition. Nothing renders them.

## What changes

**1. Delete the 4 files.** No replacement code is written — the replacements already exist
and are already live; this only removes the dead originals.

**2. Remove their 4 entries from `ORPHANS`** in `orphaned-components.test.ts`. Required, not
optional: the test's own reachability check would otherwise fail immediately on a listed
component that no longer exists on disk.

**3. Re-point `__tests__/components/local-trust.test.tsx`'s `'keeps Local Trust ROI visible
but locked for plans without access'` test** (currently at lines 76-84). It reads
`components/dashboard/WizardProgress.tsx`'s source and asserts on `key: 'roi'`,
`features.local_trust_roi`, the literal string `'Local Trust ROI'`, `'Lock'`, and the
absence of a `🔒` emoji.

That invariant — the ROI step stays visible and clickable but shows a lock affordance when
the plan lacks `local_trust_roi`, rather than disappearing or blocking navigation outright —
is real and still true, but it now lives in `components/dashboard/DashboardSidebar.tsx`, not
`WizardProgress`. Confirmed directly in that file:
- `{ key: 'roi', labelKey: 'nav_roi', icon: TrendingUp, descKey: 'nav_roi_desc' }` (STEPS
  array)
- `const unentitled = ... || (s.key === 'roi' && !features.local_trust_roi)`
- `{locked && <Lock className="size-3 ..." aria-label="Locked" />}` — rendered from the
  `lucide-react` `Lock` icon, not an emoji
- Critically, `unentitled` alone does **not** set `blocksNavigation` (only `unreachable`,
  i.e. missing brand context, does) — an unentitled-but-reachable ROI step stays a clickable
  link with reduced opacity and a lock icon, not a disabled one. That's the "visible but
  locked" behavior the test name promises.

The label text itself is now i18n'd (`nav_roi` → `"ROI"`, `nav_roi_desc` →
`"Local trust and owner proof"` in `messages/en.json`) rather than the hardcoded
`'Local Trust ROI'` string `WizardProgress` used, so the replacement assertions read
`DashboardSidebar.tsx`'s source and check for `key: 'roi'`, `features.local_trust_roi`, and
the `Lock` icon usage guarded by `locked &&` — the same invariant, pinned against the file
that actually renders it, rather than repeating a string that no longer exists anywhere in
the app.

**4. No changes needed for the other three deletions.** Grepping `__tests__/` confirms
`PlanGate`, `CheckItem`, and `SaveScanButton` are referenced only inside
`orphaned-components.test.ts`'s inventory (as string keys, never imported/rendered) — no
other test reads their source or mounts them, so deleting them requires no repointing.

## Out of scope

- The 6 Pulse-read-surface orphan entries (`pulse/ScanLogSection`, `pulse/CompetitorTab`,
  `dashboard/PulseTabs`, `pulse/CompetitorChart`, `pulse/QuestionRow`, `pulse/PlatformBar`).
  Those are fenced-with-a-restore-path, not superseded, and restoring or deleting them is a
  separate, larger decision (new data routes would be needed).
- No application code changes beyond the 4 deletions — `LockedFeature`, `ResultClient`, and
  the scan-claim funnel are pre-existing and already carry the real functionality; this work
  does not touch them.
- No behavior change for end users. Nothing currently renders the 4 deleted components, so
  there is nothing to observe differently at runtime — this is dead-code removal plus a test
  re-point, not a feature change.

## Testing

- `npm run test:unit` targeted at `orphaned-components.test.ts` and `local-trust.test.tsx`
  after each edit.
- Full `npm run lint` and `npm run typecheck` after all 4 deletions, to catch any reference
  the import-statement grep missed (e.g. a dynamic import or a type-only reference).
- Full `npm run test:unit` once at the end to confirm no other suite broke.
