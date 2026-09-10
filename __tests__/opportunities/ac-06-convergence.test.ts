import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { opportunityKey } from '@/lib/opportunities/fingerprint'

/**
 * Why AC-06 cannot be reached from here, pinned so the next person does not have
 * to rediscover it — or, worse, "implement" it by making the keys collide.
 *
 * AC-06 asks that a website finding and a question opportunity reach the same
 * asset and the same task. The acceptance matrix used to justify deferring it by
 * saying `lib/opportunities/fingerprint.ts` "already dedupes by canonical target,
 * so the seam exists". That was false in three ways, and the row was its own only
 * evidence — the phrase "canonical target" appeared nowhere else in the repository:
 *
 *   1. `opportunityKey` is keyed by SOURCE, never by target. `canonicalize` in that
 *      file is deterministic JSON serialisation (key ordering, -0, cycles), which
 *      is a different sense of the word.
 *   2. Nothing in that file dedupes at all. `fingerprintEvidence` hashes; every
 *      consumer uses the result as a staleness or integrity witness.
 *   3. There is no target to key on. A scan finding keeps `url.origin` and reduces
 *      the path to a boolean (`URL_REDACTION_VERSION = 'origin-only.v1'`,
 *      lib/scan-evidence.ts), so it names a site and never a page; a Pulse
 *      observation carries no url, page or citation field at all.
 *
 * THE TRAP THIS FILE EXISTS TO SPRING. The obvious way to "make them converge" is
 * to give both kinds the same `opportunityKey`. That is a data-loss bug, not a
 * feature: `saveAuthenticatedDraft` (lib/work-items/service.ts) looks up an
 * existing draft BY THAT KEY and returns it before it ever loads or validates the
 * second source, so the second finding's evidence snapshot is never built. The row
 * would then describe one source while claiming to represent two — the kind of
 * provenance lie this codebase spends migrations 041-046 preventing.
 *
 * Convergence needs a page-level target that neither side currently retains, and a
 * task table that can hold more than one source. Both are named in the AC-06 row.
 */

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/041_evidence_work_items.sql'),
  'utf8',
)

const PULSE_IDS = ['00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111']
const SCAN_IDS = ['00000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222']

describe('the two opportunity keyspaces are disjoint by construction', () => {
  it('never produces an equal key, even for identical ids', () => {
    // The ids deliberately overlap: the first pulse id and the first scan id are
    // the same uuid. Even then the keys differ, because ruleVersion and kind are
    // hardcoded per branch in lib/opportunities/rules.ts and lead the key.
    for (const pulseId of PULSE_IDS) {
      for (const scanId of SCAN_IDS) {
        const pulse = opportunityKey('pulse-brand-absent.v1', { kind: 'pulse-metric', id: pulseId })
        const scan = opportunityKey('scan-check-gap.v1', { kind: 'scan-check', id: scanId, checkKey: 'c9_meta_desc' })

        expect(pulse).not.toBe(scan)
      }
    }
  })

  it('carries no target: the key is exactly rule, kind, source id and check key', () => {
    // Stated as an equality rather than a description, so that adding a target
    // segment later is a deliberate edit here rather than a silent widening.
    expect(opportunityKey('scan-check-gap.v1', { kind: 'scan-check', id: SCAN_IDS[1]!, checkKey: 'c9_meta_desc' }))
      .toBe(`scan-check-gap.v1:scan-check:${SCAN_IDS[1]}:c9_meta_desc`)
  })
})

describe('the task a finding reaches is single-source at the schema level', () => {
  it('binds each source kind to exactly one rule version', () => {
    // One row names one source. Merging two kinds onto one row is refused by the
    // database, not merely by convention — which is why AC-06's task half needs a
    // migration rather than a key change.
    const check = migration.slice(
      migration.indexOf('evidence_work_items_rule_source_check'),
      migration.indexOf('evidence_work_items_snapshot_object_check'),
    )

    expect(check).toContain("source_kind = 'pulse-metric' and rule_version = 'pulse-brand-absent.v1'")
    expect(check).toContain("source_kind = 'scan-check' and rule_version = 'scan-check-gap.v1'")
  })

  it('collapses rows only on the source-derived opportunity key', () => {
    expect(migration).toContain('unique (account_id, client_id, opportunity_key)')
  })

  it('has nowhere to record an asset', () => {
    // The half of AC-06 that is about "the same asset" has no column to land in.
    // If one is ever added, this assertion should fail and be rewritten — that is
    // the point of it.
    const table = migration.slice(
      migration.indexOf('create table if not exists evidence_work_items'),
      migration.indexOf('evidence_work_items_rule_source_check'),
    )

    for (const column of ['asset', 'target', 'url', 'page', 'entity_id']) {
      expect(table, `evidence_work_items gained a ${column} column`).not.toContain(column)
    }
  })
})
