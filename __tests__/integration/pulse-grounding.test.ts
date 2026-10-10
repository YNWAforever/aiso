import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'
import { claimDueItems, commitAttempt, createOrResumeRun } from '@/lib/pulse/runs/store'
import { modelVariantsFor } from '@/lib/openrouter'
import { webSearchAllowance } from '@/lib/pulse/grounding'
import type { ProviderEvidence, PulseScope } from '@/lib/pulse/runs/schema'

vi.mock('server-only', () => ({}))

/**
 * Migration 062 against real Postgres: the ledger records how each answer was
 * produced, its pulse_metrics projection carries the citations, and the weekly
 * cap counts each web-searched answer exactly once, per account.
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
afterEach(() => {
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '')
  vi.stubEnv('PULSE_GROUNDED_ANSWERS_PER_WEEK', '')
})

const evidence: ProviderEvidence = {
  answer: 'Synthetic grounded answer', actualModel: 'synthetic/served', requestId: 'synthetic-g1',
  promptTokens: 10, completionTokens: 5, costUsd: null, httpStatus: 200,
}

async function fixture(test: (scope: PulseScope) => Promise<void>) {
  const accountId = randomUUID()
  await sql`insert into accounts(id, plan, status) values (${accountId}, 'basic', 'active')`
  const [client] = await sql`insert into clients(account_id, brand_name) values (${accountId}, 'Grounding Brand') returning id`
  const scope = { accountId, clientId: client.id as string }
  await sql`insert into prompt_bank(client_id, question, language) values (${scope.clientId}, 'Grounded question', 'en')`
  try { await test(scope) } finally {
    await sql`delete from pulse_metrics where client_id = ${scope.clientId}`
    await sql`update pulse_run_items set accepted_attempt_id = null where account_id = ${accountId}`
    await sql`delete from pulse_item_attempts where account_id = ${accountId}`
    await sql`delete from pulse_run_items where account_id = ${accountId}`
    await sql`delete from pulse_runs where account_id = ${accountId}`
    await sql`delete from prompt_bank where client_id = ${scope.clientId}`
    await sql`delete from clients where account_id = ${accountId}`
    await sql`delete from accounts where id = ${accountId}`
  }
}

async function commitWebAnswer(scope: PulseScope) {
  const run = (await createOrResumeRun(scope, { scanWeek: WEEK, manifest: modelVariantsFor(['gpt-4o']) }))!
  const [lease] = await claimDueItems(scope, run.id, { owner: 'synthetic-worker', leaseUntil: new Date(Date.now() + 60_000), limit: 1 })
  const providerCitations = [{ url: 'https://source.example/rates', title: 'Rates' }]
  expect(await commitAttempt(lease, { kind: 'succeeded', evidence: { ...evidence, providerCitations, grounding: 'web' } })).toBe('committed')
  return { lease, providerCitations }
}

describe('062 grounding', () => {
  it('records grounding on the attempt and copies citations and grounding into the projection', async () => fixture(async scope => {
    const { lease, providerCitations } = await commitWebAnswer(scope)
    const [attempt] = await sql`select grounding from pulse_item_attempts where account_id = ${scope.accountId} and id = ${lease.attemptId}`
    expect(attempt.grounding).toBe('web')
    const [metric] = await sql`select grounding, provider_citations from pulse_metrics where run_item_id = ${lease.id} and client_id = ${scope.clientId}`
    expect(metric).toEqual({ grounding: 'web', provider_citations: providerCitations })
  }))

  it('counts each web-searched answer once per account and refuses at the cap', async () => fixture(async scope => {
    await commitWebAnswer(scope)                       // 1 attempt (+ its projection, not counted twice)
    for (let i = 0; i < 2; i++) {                      // 2 legacy-writer rows
      await sql`insert into pulse_metrics (client_id, platform, question, raw_answer, scan_week, grounding)
                values (${scope.clientId}, 'gpt-4o', 'Q', 'A', ${WEEK}::date, 'web')`
    }
    await sql`insert into pulse_metrics (client_id, platform, question, raw_answer, scan_week, grounding)
              values (${scope.clientId}, 'gpt-4o', 'Q', 'A', ${WEEK}::date, 'none')`
    await sql`insert into pulse_metrics (client_id, platform, question, raw_answer, scan_week, grounding)
              values (${scope.clientId}, 'gpt-4o', 'Q', 'A', '2026-09-21'::date, 'web')`

    vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
    vi.stubEnv('PULSE_GROUNDED_ANSWERS_PER_WEEK', '4')
    expect(await webSearchAllowance(sql as never, scope.accountId, WEEK)).toEqual({ allowed: true, used: 3, cap: 4 })
    vi.stubEnv('PULSE_GROUNDED_ANSWERS_PER_WEEK', '3')
    expect((await webSearchAllowance(sql as never, scope.accountId, WEEK)).allowed).toBe(false)
    expect((await webSearchAllowance(sql as never, randomUUID(), WEEK)).used).toBe(0)
  }))

  it('rejects a grounding value outside the vocabulary', async () => fixture(async scope => {
    await expect(sql`insert into pulse_metrics (client_id, platform, question, raw_answer, scan_week, grounding)
                     values (${scope.clientId}, 'gpt-4o', 'Q', 'A', ${WEEK}::date, 'guessed')`).rejects.toThrow(/pulse_metrics_grounding_check/)
  }))
})
