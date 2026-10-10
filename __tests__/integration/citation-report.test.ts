import { beforeAll, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'
import { claimDueItems, commitAttempt, createOrResumeRun } from '@/lib/pulse/runs/store'
import { modelVariantsFor } from '@/lib/openrouter'
import { readCitationReport } from '@/lib/citations/report'
import type { ProviderEvidence, PulseScope } from '@/lib/pulse/runs/schema'

vi.mock('server-only', () => ({}))

/**
 * The citation report against real Postgres: legacy rows' own citations, ledger
 * citations read from the attempt when the projection has none (answers from
 * before 062), owned/competitor classification from the stored domains, and
 * tenancy.
 */

const sql = neon(process.env.TEST_DATABASE_URL!)
const WEEK = '2026-09-28'
beforeAll(async () => {
  const [identity] = await sql`select current_setting('neon.project_id') as project, current_setting('neon.branch_id') as branch, current_user as role`
  expect(identity.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
  vi.stubEnv('DATABASE_URL', process.env.TEST_DATABASE_URL!)
  vi.stubEnv('EXPECTED_NEON_BRANCH_ID', identity.branch)
  vi.stubEnv('EXPECTED_DB_ROLE', identity.role)
})

const evidence: ProviderEvidence = {
  answer: 'Synthetic answer', actualModel: 'synthetic/served', requestId: 'synthetic-c1',
  promptTokens: 1, completionTokens: 1, costUsd: null, httpStatus: 200,
}

async function fixture(test: (scope: PulseScope) => Promise<void>) {
  const accountId = randomUUID()
  await sql`insert into accounts(id, plan, status) values (${accountId}, 'basic', 'active')`
  const [client] = await sql`insert into clients(account_id, brand_name, domain) values (${accountId}, 'Citation Brand', 'https://www.acme-brand.com/') returning id`
  const scope = { accountId, clientId: client.id as string }
  await sql`insert into prompt_bank(client_id, question, language) values (${scope.clientId}, 'Where to bank?', 'en')`
  await sql`insert into competitors(account_id, client_id, name, domains) values (${accountId}, ${scope.clientId}, 'HSBC Holdings', array['hsbc.com.hk'])`
  try { await test(scope) } finally {
    await sql`delete from pulse_metrics where client_id = ${scope.clientId}`
    await sql`update pulse_run_items set accepted_attempt_id = null where account_id = ${accountId}`
    await sql`delete from pulse_item_attempts where account_id = ${accountId}`
    await sql`delete from pulse_run_items where account_id = ${accountId}`
    await sql`delete from pulse_runs where account_id = ${accountId}`
    await sql`delete from competitors where account_id = ${accountId}`
    await sql`delete from prompt_bank where client_id = ${scope.clientId}`
    await sql`delete from clients where account_id = ${accountId}`
    await sql`delete from accounts where id = ${accountId}`
  }
}

describe('readCitationReport', () => {
  it('reads legacy and ledger citations, classifies them, and stays inside the account', async () => fixture(async scope => {
    // Legacy-writer row with its own citations. The legacy writer always sets
    // prompt_id (app/api/pulse/run/route.ts), so the fixture does too.
    const [prompt] = await sql`select id from prompt_bank where client_id = ${scope.clientId}`
    await sql`insert into pulse_metrics (client_id, prompt_id, platform, question, raw_answer, scan_week, provider_citations, grounding)
              values (${scope.clientId}, ${prompt.id}, 'gemini-flash', 'Where to bank?', 'An answer', ${WEEK}::date,
                      ${JSON.stringify([{ url: 'https://personal.hsbc.com.hk/loans', title: 'Loans' }])}::jsonb, 'web')`
    // Ledger answer whose projection carries no citations, as before 062:
    // the report must fall back to the attempt's.
    const run = (await createOrResumeRun(scope, { scanWeek: WEEK, manifest: modelVariantsFor(['gpt-4o']) }))!
    const [lease] = await claimDueItems(scope, run.id, { owner: 'synthetic', leaseUntil: new Date(Date.now() + 60_000), limit: 1 })
    await commitAttempt(lease, { kind: 'succeeded', evidence: { ...evidence, providerCitations: [{ url: 'https://acme-brand.com/rates', title: 'Our rates' }] } })
    await sql`update pulse_metrics set provider_citations = null where run_item_id = ${lease.id} and client_id = ${scope.clientId}`

    const report = (await readCitationReport(sql as never, scope.accountId, scope.clientId))!
    expect(report.weeks).toEqual([WEEK])
    expect(report.answers).toEqual({ withCitations: 2, recordedEmpty: 0, unrecorded: 0 })
    expect(report.domains.map(d => [d.domain, d.kind, d.competitor ?? null])).toEqual([
      ['acme-brand.com', 'owned', null], ['hsbc.com.hk', 'competitor', 'HSBC Holdings'],
    ])
    // Both answers are the same question; one cites the brand, so no gap.
    expect(report.gaps).toEqual([])

    expect(await readCitationReport(sql as never, randomUUID(), scope.clientId)).toBeNull()
  }))
})
