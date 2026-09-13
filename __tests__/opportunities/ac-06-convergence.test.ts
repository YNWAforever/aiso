import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { opportunityKey } from '@/lib/opportunities/fingerprint'

/**
 * AC-06's two halves, and the line that must not move now that both are built.
 *
 * UPDATED when migration 050 added registered pages. The **asset** half is
 * reachable: an owner registers the pages that matter (`client_assets`), a scan
 * finding attaches to them by origin, and a question attaches because the owner
 * declared that the page answers it (`client_asset_questions`). That closed the
 * "no target to key on" problem below — by asking, rather than by inferring a
 * page nobody recorded.
 *
 * UPDATED AGAIN when migration 051 added `work_item_sources`. The **task** half
 * is now reachable too: a work item can hold more than one source, and
 * `lib/work-items/sources.ts`'s `attachSource` validates a second source's
 * evidence exactly as `saveAuthenticatedDraft` validates the first, before the
 * write can happen — over HTTP via
 * `app/api/dashboard/clients/[clientId]/work-items/[itemId]/sources/route.ts`.
 *
 * Building the task half did not relax the rule this file used to enforce by
 * proving it impossible — it moved that rule onto `051`, where it must hold
 * exactly as absolutely: one `work_item_sources` ROW still names exactly one
 * source (the CHECK moved, not loosened), two live rows still cannot claim the
 * same opportunity (a partial unique index, not application logic), and
 * `opportunity_key` still lives on the source, never on the item. The
 * assertions below prove all three against `051` rather than `041`.
 *
 * Everything else here — the disjoint-keyspace proof, and the trap it exists to
 * spring — is the original note, kept because it is exactly as live now as it
 * was when the task half was impossible. More so: the obvious way to "make them
 * converge" was always giving both kinds the same `opportunityKey`, and now that
 * a work item can genuinely hold two sources, that shortcut looks even more
 * tempting to a future reader than it did before.
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
 * provenance lie this codebase spends migrations 041-046 preventing. Attaching a
 * genuinely second source now goes through `attachSource` instead, a distinct
 * write path from `saveAuthenticatedDraft`'s draft-creation lookup — the two must
 * stay distinct, or this exact trap reopens with a real second source able to walk
 * into it.
 *
 * Convergence needed a page-level target that neither side retained, and a task
 * table that could hold more than one source. Both now exist; the assertions below
 * are what keeps each of them from quietly regressing.
 */

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

describe('a task may hold many sources, each still naming exactly one thing', () => {
  const expand = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/051_work_item_sources.sql'),
    'utf8',
  )

  it('moved the rule/source rule rather than relaxing it', () => {
    // One row still names one source. Merging two kinds onto one row is refused
    // by the database, not merely by convention — that did not change when the
    // rule moved off evidence_work_items.
    expect(expand).toContain("source_kind = 'pulse-metric' and rule_version = 'pulse-brand-absent.v1'")
    expect(expand).toContain("source_kind = 'scan-check' and rule_version = 'scan-check-gap.v1'")
  })

  it('still refuses to let two live sources claim one opportunity', () => {
    expect(expand).toContain('unique index work_item_sources_live_opportunity_idx')
    expect(expand).toContain('where withdrawn_at is null')
  })

  it('still keeps the opportunity key out of the work item itself', () => {
    // The trap is now the opposite one: with many sources allowed, giving the
    // ITEM a source-derived key again would re-create the collision that made
    // saveAuthenticatedDraft return a draft before validating the second source.
    expect(expand).not.toContain('alter table public.evidence_work_items add column opportunity_key')
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
