import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null, fail: false }))
vi.mock('@/lib/db', () => ({ db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  if (state.fail) throw new Error('connection failure with sensitive details')
  const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, '')
  return (await state.pg!.query(text, values)).rows
} }))
import { readAdminSchemaHealth } from '@/lib/admin/schema-health'

beforeAll(async () => { state.pg = await PGlite.create() })
afterAll(async () => { await state.pg?.close() })
describe('read-only admin schema diagnostics on local PostgreSQL', () => {
  it('reports absent capabilities without reading a migration ledger or creating tables', async () => {
    const result = await readAdminSchemaHealth()
    expect(result.status).toBe('attention')
    expect(result.checks).toHaveLength(5)
    expect(result.checks.every(check => check.missing.length > 0)).toBe(true)
    expect((await state.pg!.query("select tablename from pg_tables where schemaname = 'public'")).rows).toEqual([])
  })
  it('recognizes the onboarding columns independently while monitoring remains unavailable', async () => {
    await state.pg!.exec('create table onboarding_progress(request_hash text, request_aliases jsonb)')
    const result = await readAdminSchemaHealth()
    expect(result.checks.find(check => check.key === 'onboarding')?.missing).toEqual([])
    expect(result.checks.find(check => check.key === 'monitoring')?.missing).toContain('pulse_runs.purpose')
    expect(result.status).toBe('attention')
  })
  it('marks only the inspected columns present, without claiming production readiness', async () => {
    await state.pg!.exec(`
      create table pulse_runs(purpose text, intent_key text, source_run_id uuid);
      create table pulse_user_intents(request_hash text);
      create table pulse_run_reservations(reserved_units integer);
      create table pulse_metrics(search_evidence jsonb);
      create table pulse_item_attempts(search_evidence jsonb, grounding jsonb);
      create table pulse_classification_attempts(usage jsonb);
      create table pulse_legacy_classification_attempts(answer_hash text);
      create table prompt_batch_intents(result jsonb);
      create table work_item_groups(scope_snapshot jsonb);
      create table evidence_work_items(target_url text, owner_id uuid, due_at date, acceptance_criteria text, operation_status text);
    `)
    const result = await readAdminSchemaHealth()
    expect(result.status).toBe('columns_present')
    expect(result.checks.every(check => check.missing.length === 0)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('productionReady')
  })
  it('distinguishes a failed check from an empty successful response without exposing errors', async () => {
    state.fail = true
    try {
      const result = await readAdminSchemaHealth()
      expect(result).toMatchObject({ status: 'unavailable', checks: [] })
      expect(JSON.stringify(result)).not.toContain('sensitive')
    } finally { state.fail = false }
  })
})
