import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('@/lib/db', () => ({ db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, '')
  return state.pg!.query(text, values).then(result => result.rows)
} }))
import { readAdminDirectory } from '@/lib/admin/directory'
import { DIRECTORY_VIEWS } from '@/lib/admin/directory-schema'
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
beforeAll(async () => {
  state.pg = await PGlite.create()
  // Offline SQL execution, with the columns/types used by the migration-backed
  // stores. This is query/tenancy validation, not a hosted migration acceptance.
  await state.pg.exec(`
    create schema neon_auth;
    create table neon_auth."user"(id uuid primary key, email text);
    create table accounts(id uuid primary key, plan text, status text, stripe_subscription_id text, trial_ends_at timestamptz, override_plan text, override_expires_at timestamptz, created_at timestamptz default now());
    create table profiles(id uuid primary key, account_id uuid, display_name text, is_admin boolean, deactivated_at timestamptz, created_at timestamptz default now());
    create table clients(id uuid primary key, account_id uuid, brand_name text, domain text, industry text, status text, created_at timestamptz default now());
    create table scans(id uuid primary key, account_id uuid, domain text, score numeric, grade text, results jsonb, created_at timestamptz default now());
    create table prompt_bank(id uuid primary key, client_id uuid, question text, category text, language text, market text, is_active boolean, created_at timestamptz default now());
    create table pulse_metrics(id uuid primary key, client_id uuid, question text, platform text, scan_week date, raw_answer text, brand_mentioned boolean, classification_status text, created_at timestamptz default now());
    create table pulse_runs(id uuid primary key, account_id uuid, client_id uuid, status text, scan_week date, created_at timestamptz default now(), updated_at timestamptz default now());
    create table client_sources(id uuid primary key, account_id uuid, client_id uuid, label text, kind text, latest_version int, agent_use_allowed boolean, revoked_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create table evidence_work_items(id uuid primary key, account_id uuid, client_id uuid, title text, status text, created_at timestamptz default now(), updated_at timestamptz default now());
  `)
  for (const id of [a, b]) {
    await state.pg.query("insert into accounts(id,plan,status,stripe_subscription_id) values($1,'pro','active','sub_synthetic')", [id])
    await state.pg.query("insert into neon_auth.\"user\" values($1,$2)", [id, id === a ? 'alpha@example.test' : 'beta@example.test'])
    await state.pg.query("insert into profiles(id,account_id,display_name,is_admin) values($1,$1,$2,false)", [id, id === a ? 'Alpha' : 'Beta'])
    await state.pg.query("insert into clients(id,account_id,brand_name,domain,status) values($1,$1,$2,'example.test','active')", [id, id === a ? 'Alpha' : 'Beta'])
    await state.pg.query("insert into scans(id,account_id,domain,score,grade,results) values($1,$1,'example.test',99,'A','{}')", [id])
    await state.pg.query("insert into prompt_bank(id,client_id,question,language,market,is_active) values($1,$1,'100% synthetic question','en','HK',true)", [id])
    await state.pg.query("insert into pulse_metrics(id,client_id,question,platform,scan_week,raw_answer,brand_mentioned) values($1,$1,'Question','fixture','2026-10-05','Saved answer',true)", [id])
    await state.pg.query("insert into pulse_runs(id,account_id,client_id,status,scan_week) values($1,$1,$1,'failed','2026-10-05')", [id])
    await state.pg.query("insert into client_sources(id,account_id,client_id,label,kind,latest_version,agent_use_allowed) values($1,$1,$1,'Source','facts',1,false)", [id])
    await state.pg.query("insert into evidence_work_items(id,account_id,client_id,title,status) values($1,$1,$1,'Draft','draft')", [id])
  }
})
afterAll(async () => { await state.pg?.close() })
describe('admin directory SQL on local PostgreSQL', () => {
  it.each(DIRECTORY_VIEWS)('lists both tenants, then scopes %s to the selected tenant', async view => {
    expect((await readAdminDirectory({ view, page: 1, q: '', accountId: null })).rows).toHaveLength(2)
    const result = await readAdminDirectory({ view, page: 1, q: '', accountId: a })
    expect(result.rows).toHaveLength(1); expect(result.rows[0].account_id).toBe(a)
  })
  it('reports paid entitlement while withholding Stripe identifiers', async () => {
    const result = await readAdminDirectory({ view: 'accounts', page: 1, q: '', accountId: a })
    expect(result.rows[0].plan).toBe('pro'); expect(JSON.stringify(result)).not.toContain('sub_synthetic')
  })
  it('withholds unevidenced historical scan scores and legacy classifications', async () => {
    const scan = await readAdminDirectory({ view: 'scans', page: 1, q: '', accountId: a })
    expect(scan.rows[0]).toMatchObject({ score: null, status: 'unknown' })
    const answer = await readAdminDirectory({ view: 'observations', page: 1, q: '', accountId: a })
    expect(answer.rows[0].mentioned).toBeNull()
  })
  it('searches email and treats wildcard characters literally', async () => {
    expect((await readAdminDirectory({ view: 'users', page: 1, q: 'alpha@', accountId: null })).rows).toHaveLength(1)
    expect((await readAdminDirectory({ view: 'brands', page: 1, q: '%', accountId: null })).rows).toHaveLength(0)
    expect((await readAdminDirectory({ view: 'prompts', page: 1, q: '100%', accountId: a })).rows).toHaveLength(1)
  })
  it('surfaces auth users whose account provisioning never completed', async () => {
    await state.pg!.query('insert into neon_auth."user" values($1,$2)', ['33333333-3333-4333-8333-333333333333', 'unprovisioned@example.test'])
    const result = await readAdminDirectory({ view: 'users', page: 1, q: 'unprovisioned@', accountId: null })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ account_id: null, status: 'unprovisioned' })
    expect((await readAdminDirectory({ view: 'users', page: 1, q: 'unprovisioned@', accountId: a })).rows).toHaveLength(0)
  })
})
