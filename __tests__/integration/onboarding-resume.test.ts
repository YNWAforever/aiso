import { beforeAll, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'
import { completeOnboarding } from '@/lib/onboarding/service'
import { claimOnboardingSeed, commitOnboardingSeed, initializeOnboarding, readOnboardingProgress } from '@/lib/onboarding/store'
import { parseOnboardingInput } from '@/lib/onboarding/schema'
vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ profile: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: auth.profile }))
import { GET as readPrompts, POST as addPrompt } from '@/app/api/dashboard/clients/[clientId]/prompts/route'
import { PATCH as editPrompt } from '@/app/api/dashboard/clients/[clientId]/prompts/[promptId]/route'
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
  it('T17 concurrent manual additions and onboarding seed respect the same fifty-question cap',async()=>fixture(async accountId=>{
    auth.profile.mockResolvedValue({id:randomUUID(),account_id:accountId,accounts:{plan:'pro',status:'active',stripe_subscription_id:'synthetic'}})
    const input=parseOnboardingInput({intentKey:randomUUID(),brandName:'Synthetic cap brand',website:'https://example.test',industry:'technology',region:'HK',language:'en'})
    const progress=(await initializeOnboarding({accountId},input))!
    const clientId=progress.clientId
    await sql`insert into prompt_bank(client_id,question,language,is_active)select ${clientId},'Existing '||n,'en',true from generate_series(1,49)n`
    const add=(n:number)=>addPrompt(new Request('http://localhost',{method:'POST',body:JSON.stringify({category:'brand_query',question:`Concurrent ${n}?`,language:'en',market:'HK'})}),{params:Promise.resolve({clientId})})
    const responses=await Promise.all(Array.from({length:8},(_,n)=>add(n)))
    expect(responses.filter(r=>r.status===201)).toHaveLength(1)
    expect(responses.filter(r=>r.status===409)).toHaveLength(7)
    expect((await sql`select count(*)::int as total from prompt_bank where client_id=${clientId}`)[0].total).toBe(50)
    await sql`delete from prompt_bank where client_id=${clientId} and question like 'Concurrent %'`
    const lease=(await claimOnboardingSeed({accountId},input.intentKey))!
    await Promise.all([add(99),commitOnboardingSeed({accountId},input.intentKey,lease.token,prompts)])
    expect((await sql`select count(*)::int as total from prompt_bank where client_id=${clientId}`)[0].total).toBe(50)
  }))
  it.each(['en', 'zh-HK'] as const)('T11 API context round trip and legacy preservation %s', async language => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Context synthetic', language, region: 'HK', market: 'HK' })
    const generated = prompts.map(p => ({ ...p, language }))
    const result = await completeOnboarding({ accountId }, input, async confirmed => {
      expect(confirmed).toMatchObject({ language, market: 'HK' })
      return JSON.stringify(generated)
    })
    expect(result?.progress).toMatchObject({ prompts: 'ready', promptCount: 24 })
    const params = { params: Promise.resolve({ clientId: result!.clientId }) }
    // Synthetic Pro entitlement adapter; no actual account upgrade/role change.
    auth.profile.mockResolvedValue({ account_id: accountId, accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'synthetic' } })
    const created = await addPrompt(new Request('http://synthetic', { method: 'POST', body: JSON.stringify({ category: 'brand_query', question: 'Context round trip?', language, market: 'HK' }) }), params)
    expect(created.status).toBe(201)
    const prompt = (await created.json()).prompt
    const fetched = (await (await readPrompts(new Request('http://synthetic'), params)).json()).prompts
    expect(fetched).toHaveLength(25)
    expect(fetched.every((p: { language: string; market: string }) => p.language === language && p.market === 'HK')).toBe(true)
    const item = { params: Promise.resolve({ clientId: result!.clientId, promptId: prompt.id }) }
    expect((await editPrompt(new Request('http://synthetic', { method: 'PATCH', body: JSON.stringify({ language: 'en', market: 'US' }) }), item)).status).toBe(200)
    const [readback] = await sql`select language,market,question from prompt_bank where id=${prompt.id} and client_id=${result!.clientId}`
    expect(readback).toMatchObject({ language: 'en', market: 'US', question: 'Context round trip?' })
    await sql`update prompt_bank set language='legacy-ambiguous' where id=${prompt.id}`
    expect((await editPrompt(new Request('http://synthetic', { method: 'PATCH', body: JSON.stringify({ question: 'Legacy edited?' }) }), item)).status).toBe(200)
    expect((await sql`select language from prompt_bank where id=${prompt.id}`)[0].language).toBe('legacy-ambiguous')
    auth.profile.mockResolvedValue({ account_id: randomUUID(), accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'synthetic' } })
    expect((await readPrompts(new Request('http://synthetic'), params)).status).toBe(404)
    expect((await editPrompt(new Request('http://synthetic', { method: 'PATCH', body: JSON.stringify({ market: 'HK' }) }), item)).status).toBe(404)
  }))
  it('T11 missing confirmed language saves progress but spends no provider call', async () => fixture(async accountId => {
    const generate = vi.fn(async () => JSON.stringify(prompts))
    const result = await completeOnboarding({ accountId }, parseOnboardingInput({ brandName: 'Legacy without context', intentKey: randomUUID() }), generate)
    expect(result?.progress).toMatchObject({ prompts: 'failed', promptCount: 0, retryable: true })
    expect(generate).not.toHaveBeenCalled()
  }))
  it('rolls back the entire seed insertion after a mid-write failure and resumes the saved brand', async () => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Rollback synthetic', language: 'en' })
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
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Synthetic Brand', description: 'Persistent draft', language: 'en' })
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
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Concurrent synthetic', language: 'en' })
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
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Capped fixture', language: 'en' })
    const initialized = await initializeOnboarding({ accountId }, input)
    await sql`insert into prompt_bank (client_id, question) select ${initialized!.clientId}, 'Manual ' || n from generate_series(1,49) n`
    await completeOnboarding({ accountId }, input, async () => JSON.stringify(prompts))
    const [counts] = await sql`select count(*)::int as total, count(*) filter (where onboarding_seed_key is null)::int as manual
      from prompt_bank where client_id = ${initialized!.clientId}`
    expect(counts).toMatchObject({ total: 50, manual: 49 })
  }))
  it('fences a late seed worker after lease expiry and preserves the new lease', async () => fixture(async accountId => {
    const input = parseOnboardingInput({ intentKey: randomUUID(), brandName: 'Fenced fixture', language: 'en' })
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
