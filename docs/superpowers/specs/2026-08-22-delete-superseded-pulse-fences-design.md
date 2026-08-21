# Delete Superseded Pulse Fences Design

**Goal:** Execute a settled cleanup decision CLAUDE.md already records but nobody has carried out: delete the three `pulse/*` routes that are superseded rather than merely fenced, instead of leaving them as permanent 503 stubs.

**Context:** CLAUDE.md states plainly, in the Auth Architecture section: *"Three of the remaining fences should be deleted rather than restored, and it is worth not re-litigating that: `pulse/[clientId]/summary` and `/missed` are redundant — `clients/[clientId]/overview` is unfenced and already serves both datasets with larger limits — and `pulse/onboard` is superseded by `onboarding/complete`."* That decision was made; this is the follow-through.

Both replacement routes were verified to exist and do the claimed work, not just trusted from the doc: `app/api/clients/[clientId]/overview/route.ts:54-59` queries `pulse_weekly_summary` at `limit 40` and a missed-opportunities dataset at `limit 10` — both larger bounds than a dedicated 20-or-so-row endpoint would typically carry — and `app/api/onboarding/complete/route.ts` is a real, working route. No code anywhere calls the three routes being deleted: a repo-wide search for `fetch()` calls or import references to `pulse/onboard`, `pulse/[clientId]/summary`, or `pulse/[clientId]/missed` found nothing (two apparent grep hits were false positives on an unrelated `./summary` import path in `lib/reports/`).

`app/api/pulse/[clientId]/` contains exactly two files — `summary/route.ts` and `missed/route.ts` — so deleting both leaves the whole `[clientId]/` directory empty and removable; there is no third route under it that needs to stay.

---

## 1. Delete the three route files

- `app/api/pulse/onboard/route.ts`
- `app/api/pulse/[clientId]/summary/route.ts`
- `app/api/pulse/[clientId]/missed/route.ts`

All three are currently identical-shaped fence stubs (`return featureUnavailable('pulse')`), so there is no logic to migrate — this is a pure deletion. The `app/api/pulse/[clientId]/` directory is removed once both files under it are gone.

## 2. Remove their entries from the canonical fenced-route list

`__tests__/api/fenced-routes.test.ts` asserts each fenced route still 503s; that assertion is meaningless for a route that no longer exists (Next.js 404s a missing route file, it doesn't return the old handler). Remove all three entries from the `FENCED` array.

## 3. Update CLAUDE.md

Two changes to the Auth Architecture section:

- Remove `pulse/onboard` and `pulse/[clientId]/*` from the fenced-routes list — they are neither fenced nor restored now; they don't belong in either list.
- Add a short note, in the same style as the existing `notifications/*` restored-not-deleted paragraph, recording that these three were deleted (not restored) and pointing at their replacements — so a future reader who searches for `pulse/onboard` or `pulse/[clientId]/summary` finds an explanation instead of a dead end.

## 4. Correct the orphaned-Pulse-UI comment

`__tests__/components/orphaned-components.test.ts` keeps six components orphaned rather than deleted — `pulse/ScanLogSection`, `pulse/CompetitorTab`, `dashboard/PulseTabs`, and three that render only inside those — with a comment explaining why: *"Kept because restoring the standalone /pulse page is still on the table."* That page's data would have come from exactly the two routes this phase deletes.

Per explicit decision: **the six components stay orphaned.** They remain the only implementation of that UI, and deleting them would mean rewriting from scratch if the feature is ever rebuilt — that's a bigger, separate decision this cleanup isn't making. What changes is only the *reason* — it currently asserts something that stops being true the moment this phase's routes are deleted. Reworded to state that a rebuild would need new data routes, since `summary`/`missed` were deleted rather than fenced.

---

## What this design deliberately does not do

- **Does not delete the six orphaned Pulse UI components** (`ScanLogSection`, `CompetitorTab`, `PulseTabs`, and their three downstream-only components). Per explicit decision, they stay — only their stated reason changes.
- **Does not touch `pulse/run`, `pulse/suggest-questions`, or any other already-restored Pulse route.** Only the three explicitly-superseded ones are in scope.
- **Does not add or modify any test asserting new behavior.** Deleting a 503 stub removes behavior; it doesn't add any to verify. The fenced-routes test's own updated (shrunk) assertion set is the verification that the routes are genuinely gone.
- **Does not modify `clients/[clientId]/overview` or `onboarding/complete`.** Both already exist and already do the superseding work; this phase only removes the routes they've made redundant.
