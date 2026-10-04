import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { listSourcePage } from '@/lib/sources/pagination'
import { parseSourceQuery } from '@/lib/sources/query'
import { buildSourceContent, hashSourceContent } from '@/lib/sources/schema'

vi.mock('server-only', () => ({}))
const captured = vi.hoisted(() => ({ query: null as { text: string; values: unknown[] } | null }))
vi.mock('@/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db')>()
  return { ...real, db: () => new Proxy(real.db(), {
    apply(target, self, args) {
      const [strings, ...values] = args as [TemplateStringsArray, ...unknown[]]
      captured.query = { text: strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values }
      return Reflect.apply(target, self, args)
    },
  }) }
})

const owner = neon(process.env.TEST_DATABASE_URL!)
const accountId = randomUUID()
let clientId: string
let fixtureBytes: number
beforeAll(async () => {
  const [identity] = await owner`select current_setting('neon.project_id') as project, current_setting('neon.branch_id') as branch, current_user as role`
  expect(identity.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
  vi.stubEnv('DATABASE_URL', process.env.BENCH_APP_DATABASE_URL ?? process.env.TEST_DATABASE_URL!)
  vi.stubEnv('EXPECTED_NEON_BRANCH_ID', identity.branch as string)
  vi.stubEnv('EXPECTED_DB_ROLE', process.env.BENCH_APP_DATABASE_URL ? 'aeo_app' : identity.role as string)
  await owner`insert into accounts (id,plan,status) values (${accountId},'pro','active')`
  const [brand] = await owner`insert into clients (account_id,brand_name,status,competitors) values (${accountId},'Isolated source query-plan fixture','active',${[]}::text[]) returning id`
  clientId = brand.id as string
  const content = buildSourceContent(Array.from({ length: 32 }, (_, i) => ({ question: `Synthetic question ${i}`, answer: randomBytes(512).toString('hex') })))
  fixtureBytes = Buffer.byteLength(JSON.stringify(content)) * 201
  await owner`
    with sources as (
      insert into client_sources (account_id,client_id,source_key,kind,label,latest_version)
      select ${accountId},${clientId},'plan-fixture-'||n,'facts','Synthetic source '||n,1 from generate_series(1,201) n returning *
    ) insert into client_source_versions (account_id,client_id,source_id,version_number,content,content_hash,import_method)
    select account_id,client_id,id,1,${JSON.stringify(content)}::jsonb,${hashSourceContent(content)},'paste' from sources
  `
})
afterAll(async () => {
  await owner`delete from client_source_versions where account_id=${accountId}`
  await owner`delete from client_sources where account_id=${accountId}`
  await owner`delete from clients where account_id=${accountId}`
  await owner`delete from accounts where id=${accountId}`
  vi.unstubAllEnvs()
})

type PlanNode = { 'Node Type': string; 'Actual Rows': number; 'Actual Loops': number; Output?: string[]; Plans?: PlanNode[] }
function contentEvaluations(node: PlanNode): { node: string; rows: number; expressions: string[] }[] {
  const expressions = (node.Output ?? []).filter(value => value.includes('jsonb_array_length('))
  // Expressions inside an aggregate argument execute for each input row, not
  // once for the single aggregate output row.
  const evaluated = node['Node Type'].endsWith('Aggregate') && node.Plans?.length === 1 ? node.Plans[0] : node
  return [...(expressions.length ? [{ node: node['Node Type'], rows: evaluated['Actual Rows'] * evaluated['Actual Loops'], expressions }] : []), ...(node.Plans ?? []).flatMap(contentEvaluations)]
}

describe('source page real query-plan bounds', () => {
  it('evaluates source content only for the selected page and its cursor sentinel', async () => {
    const pages = []
    let cursor: string | null = null
    const explain = neon(process.env.BENCH_APP_DATABASE_URL ?? process.env.TEST_DATABASE_URL!)
    for (let page = 0; page < 2; page++) {
      const query = parseSourceQuery(new URL(`http://127.0.0.1/sources?limit=50${cursor ? `&cursor=${cursor}` : ''}`).searchParams, accountId, clientId)
      const result = await listSourcePage({ accountId, clientId, actorId: randomUUID() }, query)
      expect(result!.items).toHaveLength(50)
      expect(result!.total).toBe(201)
      expect(result!.items.every(item => item.current?.entryCount === 32)).toBe(true)
      expect(JSON.stringify(result)).not.toContain('Synthetic question')
      const sql = captured.query!
      const [plan] = await explain.query(`explain (analyze,verbose,buffers,format json) ${sql.text}`, sql.values)
      const document = plan['QUERY PLAN'] as { Plan: PlanNode }[]
      const evaluations = contentEvaluations(document[0].Plan)
      expect(evaluations.length).toBeGreaterThan(0)
      pages.push({ page, itemIds: result!.items.map(item => item.id), payloadBytes: Buffer.byteLength(JSON.stringify(result)), evaluations, plan: document })
      cursor = result!.nextCursor
    }
    expect(new Set(pages.flatMap(page => page.itemIds)).size).toBe(100)
    if (process.env.PERF_ARTIFACT_DIR) {
      mkdirSync(process.env.PERF_ARTIFACT_DIR, { recursive: true })
      writeFileSync(join(process.env.PERF_ARTIFACT_DIR, 'source-query-plans.json'), JSON.stringify({ fixture: { sources: 201, entriesPerSource: 32, fixtureBytes }, pages }, null, 2))
    }
    for (const page of pages) for (const evaluation of page.evaluations) expect(evaluation.rows).toBeLessThanOrEqual(51)
  })
})