import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 051 moves seven columns out of evidence_work_items without loosening a single
 * rule. These assertions are about the SQL text, so they run without a database
 * and fail the moment a constraint is dropped rather than relocated.
 */
const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/051_work_item_sources.sql'),
  'utf8',
)

describe('051 creates the source child table', () => {
  it('binds tenancy with a composite foreign key, like 042 does', () => {
    expect(sql).toContain('create table public.work_item_sources')
    expect(sql).toContain('references public.evidence_work_items (account_id, client_id, id)')
  })

  it('moves the rule/source rule verbatim, one source at a time', () => {
    expect(sql).toContain("source_kind = 'pulse-metric' and rule_version = 'pulse-brand-absent.v1'")
    expect(sql).toContain("source_kind = 'scan-check' and rule_version = 'scan-check-gap.v1'")
    expect(sql).toContain("source_kind = 'agent-recommendation' and rule_version = 'stored-recommendation.v1'")
  })

  it('keeps the snapshot guards that 041 had', () => {
    expect(sql).toContain("jsonb_typeof(evidence_snapshot) = 'object'")
    expect(sql).toContain('octet_length(evidence_snapshot::text) <= 65536')
  })

  it('makes an opportunity unique only among live rows', () => {
    // The whole recoverability story. A withdrawn row keeps its key but stops
    // occupying it, so a mis-attachment can be undone.
    expect(sql).toContain('unique index work_item_sources_live_opportunity_idx')
    expect(sql).toContain('where withdrawn_at is null')
  })

  it('refuses a half-recorded withdrawal', () => {
    expect(sql).toContain('(withdrawn_at is null) = (withdrawn_by is null)')
  })

  it('grants the app role no DELETE', () => {
    // Withdrawal is an update. A source row is never removed.
    expect(sql).toContain('grant select, insert, update on public.work_item_sources to aeo_app')
    expect(sql).not.toContain('grant select, insert, update, delete on public.work_item_sources')
  })

  it('keeps the old columns, because this is the expand half', () => {
    // Dropping them belongs to 052, after the new code has run in production.
    expect(sql).not.toContain('drop column')
  })

  it('teaches the version content check about schemaVersion 2', () => {
    expect(sql).toContain('work_item_versions_content_check')
    expect(sql).toContain("content->'schemaVersion' in ('1'::jsonb, '2'::jsonb)")
    expect(sql).toContain('evidenceSnapshots')
  })
})
