import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { opportunityKey } from '@/lib/opportunities/fingerprint'

/**
 * AC-06's two halves, and the line between them.
 *
 * UPDATED when migration 050 added registered pages. The **asset** half is now
 * reachable: an owner registers the pages that matter (`client_assets`), a scan
 * finding attaches to them by origin, and a question attaches because the owner
 * declared that the page answers it (`client_asset_questions`). That closes the
 * "no target to key on" problem below — by asking, rather than by inferring a
 * page nobody recorded.
 *
 * The **task** half is still out of reach, for the reason that has not changed:
 * `evidence_work_items` is single-source by CHECK constraint, and merging two
 * sources onto one row would make it claim a provenance it does not have. The
 * assertions below still hold and still must.
 *
 * Everything from here down is the original note, kept because the trap it
 * describes is exactly as live now as it was then — more so, since the asset
 * half existing makes "and now merge the tasks too" look like the obvious next
 * step.
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

  it('still has nowhere to record an asset, and must not gain one here', () => {
    // The asset half of AC-06 is served by client_assets (migration 050), NOT by
    // a column on the task. Adding one here would be the first step of the merge
    // this file exists to prevent: once a work item names an asset, collapsing
    // two sources onto it looks like deduplication rather than data loss.
    const table = migration.slice(
      migration.indexOf('create table if not exists evidence_work_items'),
      migration.indexOf('evidence_work_items_rule_source_check'),
    )

    for (const column of ['asset', 'target', 'url', 'page', 'entity_id']) {
      expect(table, `evidence_work_items gained a ${column} column`).not.toContain(column)
    }
  })
})

describe('the asset half is reached without touching the task half', () => {
  const assets = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/050_registered_page_assets.sql'),
    'utf8',
  )

  it('gives an owner a page to register, with its origin stored alongside', () => {
    // `origin` is the join AC-06 rests on: a scan finding keeps origin and
    // nothing finer, so this is the only column it can be matched against.
    expect(assets).toContain('create table public.client_assets')
    expect(assets).toContain('url text not null')
    expect(assets).toContain('origin text not null')
  })

  it('records "this page answers this question" as a declaration, not an inference', () => {
    expect(assets).toContain('create table public.client_asset_questions')
    expect(assets).toContain('declared_by')
  })

  it('binds a declaration to its asset by account and client together', () => {
    // Composite FK, so a declaration cannot reference another account's page
    // even if the caller supplies its id.
    expect(assets).toContain('references public.client_assets (account_id, client_id, id)')
  })

  it('cannot bind the prompt compositely, and says so where a reader will look', () => {
    // prompt_bank predates tenancy: no account_id, and a plain FK to clients(id).
    // The guarantee therefore lives in lib/assets/store.ts's insert, which joins
    // the prompt on the asset's own client_id. If that comment ever stops being
    // true, this is where someone finds out.
    expect(assets).toContain('references public.prompt_bank (id)')
    expect(assets).toContain('prompt_bank predates tenancy')
  })

  it('adds no work-item table, column or constraint', () => {
    // The whole point of keeping the two halves separate, asserted rather than
    // trusted: 050 must not touch the task at all.
    expect(assets).not.toContain('evidence_work_items')
    expect(assets).not.toContain('opportunity_key')
  })
})
