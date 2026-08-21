import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Components nothing renders, and why each one is still here.
 *
 * They accumulated during the Supabase-to-Neon fencing: a route was fenced, its
 * page was reduced to a placeholder, and the components below it were left
 * behind with no importer. Nothing surfaced that, so the set grew silently and
 * an eighth orphan would have been indistinguishable from the first.
 *
 * This is the same shape as __tests__/api/fenced-routes.test.ts: an explicit
 * inventory with a reason per entry, which fails both when a new orphan appears
 * and when a listed one becomes reachable. Deleting is not automatically the
 * right fix — most of these are the only implementation of a feature that is
 * fenced rather than abandoned, so throwing them away would mean rewriting them
 * to restore it. What was missing was the decision being visible.
 */
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

  // The "no producer in any commit" reason for deleting this expired: alert
  // evaluation writes notifications now (upsertNotification in
  // lib/alerts/neon-store.ts). The routes serving the bell are still fenced
  // though, so it stays orphaned until restore-vs-delete is re-decided.
  'dashboard/NotificationBell': 'notifications routes still fenced, so nothing feeds it',

  // Superseded rather than fenced. The dashboard page renders its own step
  // switch and the sidebar links all five steps again, so WizardProgress now
  // duplicates both. Two assertions in local-trust.test.tsx read its source, so
  // it cannot be deleted without deciding what those should pin instead.
  'dashboard/WizardProgress': 'superseded by the dashboard page step switch',

  'dashboard/PlanGate': 'entitlement wrapper superseded by LockedFeature',
  'CheckItem': 'superseded by the result page check rendering',
  'SaveScanButton': 'superseded by the scan-claim funnel',
}

/** Component files, excluding shadcn/ui primitives (lowercase by convention). */
function componentFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`)
      else if (entry.name.endsWith('.tsx')) out.push(`${prefix}${entry.name.replace(/\.tsx$/, '')}`)
    }
  }
  walk('components', '')
  // components/ui holds shadcn primitives, which are vendored and expected to
  // include pieces this app does not use yet.
  return out.filter(f => !f.startsWith('ui/'))
}

/**
 * Component names a file imports, both `@/components/x/Y` and sibling-relative.
 *
 * Only real imports count. A component named in a comment — the prompts page
 * explains why it does NOT use QuestionBankSection — is not a use.
 */
function importsIn(path: string): string[] {
  const src = readFileSync(join(process.cwd(), path), 'utf8')
  const names = [...src.matchAll(/from\s+'@\/components\/([^']+)'/g)].map(m => m[1])
  if (path.startsWith('components/')) {
    const here = path.replace(/^components\//, '').replace(/\/[^/]+$/, '')
    const dir = here === path.replace(/^components\//, '') ? '' : here
    for (const m of src.matchAll(/from\s+'\.\/([^']+)'/g)) {
      names.push(dir ? `${dir}/${m[1]}` : m[1])
    }
    for (const m of src.matchAll(/from\s+'\.\.\/([^']+)'/g)) names.push(m[1])
  }
  return names
}

function filesUnder(dir: string, match: RegExp): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(join(process.cwd(), d), { withFileTypes: true })) {
      const path = `${d}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (match.test(entry.name)) out.push(path)
    }
  }
  walk(dir)
  return out
}

/**
 * Components reachable from a rendered page, transitively.
 *
 * Reachability has to start at `app/` and follow imports, not merely ask "does
 * anything import this". SuggestQuestionsPanel is imported — by
 * QuestionBankSection, which nothing renders. Counting that as reachable would
 * hide a whole orphaned subtree behind its root, which is exactly how this set
 * grew unnoticed in the first place.
 */
function reachableComponents(): Set<string> {
  const reached = new Set<string>()
  const queue: string[] = []

  for (const file of [...filesUnder('app', /\.(ts|tsx)$/), ...filesUnder('lib', /\.(ts|tsx)$/)]) {
    for (const name of importsIn(file)) {
      if (!reached.has(name)) { reached.add(name); queue.push(name) }
    }
  }

  while (queue.length) {
    const name = queue.pop() as string
    const path = `components/${name}.tsx`
    let children: string[]
    try { children = importsIn(path) } catch { continue }
    for (const child of children) {
      if (!reached.has(child)) { reached.add(child); queue.push(child) }
    }
  }
  return reached
}

describe('orphaned components', () => {
  const imported = reachableComponents()
  const orphans = componentFiles().filter(f => !imported.has(f)).sort()

  it('has no orphan that is not accounted for', () => {
    // A new entry here means a component was left behind by a change. Either
    // wire it up or record why it is staged — do not let the set grow silently.
    const unlisted = orphans.filter(o => !(o in ORPHANS))

    expect(unlisted, `unaccounted orphaned components: ${unlisted.join(', ')}`).toEqual([])
  })

  it('lists nothing that is actually reachable', () => {
    // The other direction: once a fenced feature comes back, its component stops
    // being an orphan and must leave this list, so the inventory cannot rot into
    // a description of the past.
    const stale = Object.keys(ORPHANS).filter(name => imported.has(name))

    expect(stale, `no longer orphaned, remove from ORPHANS: ${stale.join(', ')}`).toEqual([])
  })

  it('gives every entry a reason', () => {
    for (const [name, reason] of Object.entries(ORPHANS)) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(15)
    }
  })
})
