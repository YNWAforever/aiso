import { beforeAll, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'
import { completeOnboarding } from '@/lib/onboarding/service'
import { claimOnboardingSeed, commitOnboardingSeed, initializeOnboarding, readOnboardingProgress } from '@/lib/onboarding/store'
import { parseOnboardingInput } from '@/lib/onboarding/schema'
vi.mock('server-only', () => ({}))
const sql = neon(process.env.TEST_DATABASE_URL!)
beforeAll(async () => {
  const [identity] = await sql`select current_setting('neon.project_id') as project, current_setting('neon.branch_id') as branch, current_user as role`
  expect(identity.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
  vi.stubEnv('DATABASE_URL', process.env.TEST_DATABASE_URL!)
  vi.stubEnv('EXPECTED_NEON_BRANCH_ID', identity.branch)
  vi.stubEnv('EXPECTED_DB_ROLE', identity.role)
})
const prompts = Array.from({ length: 24 }, (_, n) => ({ category: 'brand_query', question: `Synthetic question ${n + 1}?`, language: 'en' }))
async function fixture(run: (accountId: string) => Promise<void>) {
  const accountId = randomUUID()
  await sql`insert into accounts (id, plan, status) values (${accountId}, 'basic', 'active')`
  try { await run(accountId) }
  finally {
    await sql`delete from onboarding_progress where account_id = ${accountId}`
    await sql`delete from clients where account_id = ${accountId}`
    await sql`delete from accounts where id = ${accountId}`
  }
}
describe('T10 persistent onboarding resume through guarded HTTP SQL', () => {
  it('rolls back the entire seed insertion after a mid-write failure and resumes the saved brand', async () => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Rollback synthetic' })
    await sql`create function public.t10_fail_seed_fixture() returns trigger language plpgsql as $$
      begin if new.question = 'T10_FAIL_INSERT_SENTINEL' then raise exception 'Synthetic seed write failure'; end if; return new; end $$`
    await sql`create trigger t10_fail_seed_fixture before insert on prompt_bank for each row execute function public.t10_fail_seed_fixture()`
    let first: Awaited<ReturnType<typeof completeOnboarding>>
    try {
      first = await completeOnboarding({ accountId }, input, async () => JSON.stringify([prompts[0], {...prompts[1],question:'T10_FAIL_INSERT_SENTINEL'}]))
      expect(first?.progress).toMatchObject({ prompts: 'failed', promptCount: 0, retryable: true })
    } finally {
      await sql`drop trigger t10_fail_seed_fixture on prompt_bank`
      await sql`drop function public.t10_fail_seed_fixture()`
    }
    const next = await completeOnboarding({ accountId }, input, async () => JSON.stringify(prompts))
    expect(next?.clientId).toBe(first!.clientId)
    expect(next?.trialEndsAt).toBe(first!.trialEndsAt)
    expect(next?.progress.promptCount).toBe(24)
  }))
  it('seed_failure_resumes_same_client and trial without losing draft or manual questions', async () => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Synthetic Brand', description: 'Persistent draft' })
    const first = await completeOnboarding({ accountId }, input, async () => { throw new Error('synthetic timeout') })
    expect(first?.progress).toMatchObject({ prompts: 'failed', promptCount: 0, retryable: true, errorCode: 'ONBOARDING_SEED_FAILED' })
    await sql`insert into prompt_bank (client_id, question) values (${first!.clientId}, 'Manual question survives?')`
    const next = await completeOnboarding({ accountId }, input, async () => JSON.stringify(prompts))
    expect(next?.clientId).toBe(first?.clientId)
    expect(next?.trialEndsAt).toBe(first?.trialEndsAt)
    expect(next?.progress).toMatchObject({ prompts: 'ready', promptCount: 25, retryable: false })
    const [counts] = await sql`select count(*)::int as n from clients where account_id = ${accountId}`
    expect(counts.n).toBe(1)
    const [draft] = await sql`select draft from onboarding_progress where account_id = ${accountId}`
    expect(draft.draft.description).toBe('Persistent draft')
  }))
  it('two concurrent retries seed exactly once and do not create extra trials or brands', async () => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Concurrent synthetic' })
    const generate = vi.fn(async () => JSON.stringify(prompts))
    const results = await Promise.all([completeOnboarding({ accountId }, input, generate), completeOnboarding({ accountId }, input, generate)])
    expect(new Set(results.map(r => r?.clientId)).size).toBe(1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect((await readOnboardingProgress({ accountId }, input.intentKey))?.progress.promptCount).toBe(24)
    const again = await completeOnboarding({ accountId }, { ...input, intentKey: randomUUID(), clientId: results[0]!.clientId }, generate)
    expect(again?.progress.promptCount).toBe(24)
    expect(generate).toHaveBeenCalledTimes(1)
  }))
  it('rejects account B requested client and unrelated scan before starting a trial', async () => fixture(async accountId => {
    const otherId = randomUUID()
    await sql`insert into accounts (id, plan, status) values (${otherId}, 'basic', 'active')`
    const [other] = await sql`insert into clients (account_id, brand_name) values (${otherId}, 'Other fixture') returning id`
    try {
      const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Foreign', clientId: other.id })
      expect(await initializeOnboarding({ accountId }, input)).toBeNull()
      const [account] = await sql`select trial_started_at from accounts where id = ${accountId}`
      expect(account.trial_started_at).toBeNull()
    } finally {
      await sql`delete from clients where account_id = ${otherId}`
      await sql`delete from accounts where id = ${otherId}`
    }
  }))
  it('caps generated insertion at 50 while preserving manual rows', async () => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Capped fixture' })
    const initialized = await initializeOnboarding({ accountId }, input)
    await sql`insert into prompt_bank (client_id, question) select ${initialized!.clientId}, 'Manual ' || n from generate_series(1,49) n`
    await completeOnboarding({ accountId }, input, async () => JSON.stringify(prompts))
    const [counts] = await sql`select count(*)::int as total, count(*) filter (where onboarding_seed_key is null)::int as manual
      from prompt_bank where client_id = ${initialized!.clientId}`
    expect(counts).toMatchObject({ total: 50, manual: 49 })
  }))
  it('fences a late seed worker after lease expiry and preserves the new lease', async () => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Fenced fixture' })
    await initializeOnboarding({ accountId }, input)
    const old = await claimOnboardingSeed({ accountId }, input.intentKey)
    await sql`update onboarding_progress set lease_until = now() - interval '1 second' where account_id = ${accountId}`
    const current = await claimOnboardingSeed({ accountId }, input.intentKey)
    await commitOnboardingSeed({ accountId }, input.intentKey, old!.token, prompts)
    expect((await readOnboardingProgress({ accountId }, input.intentKey))?.progress).toMatchObject({ prompts: 'running', promptCount: 0 })
    await commitOnboardingSeed({ accountId }, input.intentKey, current!.token, prompts)
    expect((await readOnboardingProgress({ accountId }, input.intentKey))?.progress).toMatchObject({ prompts: 'ready', promptCount: 24 })
  }))
})
