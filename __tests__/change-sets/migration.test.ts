import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const path = 'supabase/migrations/042_change_set_approvals.sql'
const sql = existsSync(path) ? readFileSync(path,'utf8').toLowerCase() : ''
describe('immutable change-set migration', () => {
  it.each(['work_item_versions','work_item_decisions','account_approver_state','account_approver_events'])('creates %s with explicit privileges', table => {
    expect(sql).toContain(`create table public.${table}`)
    expect(sql).toContain(`revoke all on public.${table} from public`)
    expect(sql).toContain(`revoke all on public.${table} from aeo_app`)
    expect(sql).toContain(`grant select, insert${table === 'account_approver_state' ? ', update' : ''} on public.${table} to aeo_app`)
  })
  it('retains all history and actor identifiers', () => {
    expect(sql).toContain('on delete restrict')
    expect(sql).not.toMatch(/on delete (cascade|set null)/)
    expect(sql).not.toMatch(/references public.profiles/)
  })
  it('binds exact tenant, item, version and hash', () => {
    expect(sql).toContain('references public.evidence_work_items (account_id, client_id, id)')
    expect(sql).toContain('references public.work_item_versions (account_id, client_id, work_item_id, id, content_hash)')
    expect(sql).toContain('unique (account_id, client_id, work_item_id, draft_revision)')
    expect(sql).toContain('unique (account_id, client_id, work_item_id, version_number)')
  })
  it('fails closed for required JSON members and sizes', () => {
    expect(sql).toContain('is true')
    expect(sql).toContain('131072')
    expect(sql).toContain('65536')
    expect(sql).toContain("change-set-review.v1")
    expect(sql).toContain("jsonb_typeof(content->'evidenceSnapshot')".toLowerCase())
    expect(sql).toContain("normalize(reason, nfc)")
  })
  it('supports event-first atomic initialization and exact grant reference', () => {
    expect(sql).toContain('deferrable initially deferred')
    expect(sql).toContain('unique (account_id, profile_id, new_revision)')
    expect(sql).toContain('references public.account_approver_events (account_id, profile_id, new_revision, id)')
  })
})

it('pins the nested evidence schema and released source kinds', () => {
  expect(sql).toContain("content->'evidencesnapshot'->'schemaversion' = '1'::jsonb")
  expect(sql).toContain("content->'evidencesnapshot'->'source'->>'kind' in ('pulse-metric', 'scan-check')")
})
