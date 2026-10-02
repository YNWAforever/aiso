import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { seedKey, type OnboardingInput, type OnboardingProgress, type OnboardingScope, type SeedPrompt } from './schema'

type ProgressRow = Record<string, unknown> & { intent_key: string; client_id: string; scan_id: string | null; prompt_status: OnboardingProgress['prompts']; prompt_count: number; error_code: string | null; trial_ends_at: Date | string; lease_until: Date | string | null }
const dto = (row: ProgressRow) => ({ intentKey: row.intent_key, clientId: row.client_id, scanId: row.scan_id,
  trialEndsAt: new Date(row.trial_ends_at).toISOString(), progress: {
    clientId: row.client_id, brand: 'ready' as const, prompts: row.prompt_status, promptCount: Number(row.prompt_count),
    scanId: row.scan_id, retryable: row.prompt_status === 'failed' || row.prompt_status === 'pending'
      || (row.prompt_status === 'running' && row.lease_until !== null && new Date(row.lease_until).getTime() < Date.now()), errorCode: row.error_code,
  } })

export async function ownedOnboardingScan(scope: OnboardingScope, scanId: string): Promise<boolean> {
  const rows = await db()`select id from scans where id = ${scanId}::uuid and account_id = ${scope.accountId}`
  return rows.length === 1
}

export async function readOnboardingProgress(scope: OnboardingScope, intentKey: string) {
  const sql = db()
  const rows = await sql`select p.*, a.trial_ends_at,
      (select count(*)::int from prompt_bank pb where pb.client_id = p.client_id) as prompt_count
    from onboarding_progress p join accounts a on a.id = p.account_id
    where p.account_id = ${scope.accountId} and p.intent_key = ${intentKey}`
  return rows[0] ? dto(rows[0] as ProgressRow) : null
}

export async function initializeOnboarding(scope: OnboardingScope, input: OnboardingInput) {
  const sql = db()
  const [, rows] = await sql.transaction([
    sql`select id from accounts where id = ${scope.accountId} for update`,
    sql`with previous as (
      select client_id, scan_id from onboarding_progress where account_id = ${scope.accountId} and intent_key = ${input.intentKey}
    ), permitted as (
      select id from accounts where id = ${scope.accountId}
        and (${input.scanId}::uuid is null or exists (select 1 from scans where id = ${input.scanId}::uuid and account_id = ${scope.accountId}
          and (client_id is null or client_id = coalesce((select client_id from previous), ${input.clientId}::uuid))))
        and (${input.clientId}::uuid is null or exists (
          select 1 from clients where id = ${input.clientId}::uuid and account_id = ${scope.accountId}))
        and not exists (select 1 from previous where ${input.clientId}::uuid is not null and client_id <> ${input.clientId}::uuid)
        and not exists (select 1 from previous where ${input.scanId}::uuid is not null and scan_id is not null and scan_id <> ${input.scanId}::uuid)
    ), existing as (
      select id from clients where account_id = ${scope.accountId} and (
        id = (select client_id from previous)
        or (not exists (select 1 from previous) and id = ${input.clientId}::uuid)
        or (not exists (select 1 from previous) and ${input.clientId}::uuid is null
          and lower(brand_name) = lower(${input.brandName}) and domain is not distinct from ${input.domain}))
      order by created_at, id limit 1
    ), trial as (
      update accounts set trial_started_at = coalesce(trial_started_at, now()),
        trial_ends_at = coalesce(trial_ends_at, coalesce(trial_started_at, now()) + interval '7 days')
      where id in (select id from permitted) returning id, trial_ends_at
    ), created as (
      insert into clients (account_id, brand_name, domain, industry, region, description, competitors, status)
      select id, ${input.brandName}, ${input.domain}, ${input.industry}, ${input.region}, ${input.description}, ${input.competitors}::text[], 'active'
      from trial where not exists (select 1 from existing) and ${input.clientId}::uuid is null returning id
    ), chosen as (select id from existing union all select id from created), progress as (
      insert into onboarding_progress (account_id, intent_key, client_id, scan_id, draft)
      select ${scope.accountId}, ${input.intentKey}, chosen.id, ${input.scanId}::uuid, ${JSON.stringify(input)}::jsonb
      from chosen join trial on true
      on conflict (account_id, client_id) do update set draft = excluded.draft,
        scan_id = coalesce(onboarding_progress.scan_id, excluded.scan_id), updated_at = now()
      returning *
    ), associated as (
      update scans set client_id = (select client_id from progress)
      where id = ${input.scanId}::uuid and account_id = ${scope.accountId}
        and (client_id is null or client_id = (select client_id from progress)) returning id
    ) select progress.*, trial.trial_ends_at from progress join trial on true`,
  ])
  return rows[0] ? dto(rows[0] as ProgressRow) : null
}

export async function claimOnboardingSeed(scope: OnboardingScope, intentKey: string) {
  const sql = db(), token = randomUUID()
  const rows = await sql`update onboarding_progress set prompt_status = 'running', error_code = null,
    lease_token = ${token}::uuid, lease_until = now() + interval '90 seconds', updated_at = now()
    from clients c where onboarding_progress.account_id = ${scope.accountId} and intent_key = ${intentKey}
      and c.id = onboarding_progress.client_id and c.account_id = onboarding_progress.account_id
      and (prompt_status in ('pending','failed') or (prompt_status = 'running' and lease_until < now()))
    returning client_id, draft, c.brand_name, c.domain, c.industry, c.region, c.description, c.competitors`
  const row = rows[0]
  return row ? { token, clientId: row.client_id as string, input: { ...(row.draft as OnboardingInput),
    brandName: row.brand_name as string, domain: row.domain as string | null, industry: row.industry as string | null,
    region: row.region as string | null, description: row.description as string | null, competitors: row.competitors as string[] ?? [] } } : null
}

export async function commitOnboardingSeed(scope: OnboardingScope, intentKey: string, token: string, prompts: SeedPrompt[]) {
  const sql = db()
  await sql.transaction([
    sql`select c.id from clients c join onboarding_progress p on p.client_id = c.id and p.account_id = c.account_id
      where c.account_id = ${scope.accountId} and p.intent_key = ${intentKey} for no key update of c`,
    sql`with leased as (
      select client_id from onboarding_progress where account_id = ${scope.accountId} and intent_key = ${intentKey}
        and lease_token = ${token}::uuid and lease_until > now() and prompt_status = 'running' for update
    ), input as (
      select cat, question, language, seed_key, row_number() over () as n from unnest(
        ${prompts.map(p => p.category)}::text[], ${prompts.map(p => p.question)}::text[],
        ${prompts.map(p => p.language)}::text[], ${prompts.map(seedKey)}::text[]) as t(cat, question, language, seed_key)
    ), inserted as (
      insert into prompt_bank (client_id, category, question, language, is_active, onboarding_seed_key)
      select leased.client_id, input.cat, input.question, input.language, true, input.seed_key from leased join input on true
      where input.n <= greatest(0, 50 - (select count(*) from prompt_bank where client_id = leased.client_id))
      on conflict (client_id, onboarding_seed_key) where onboarding_seed_key is not null do nothing returning id
    ) update onboarding_progress set prompt_status = 'ready', error_code = null, lease_token = null, lease_until = null,
      prompt_count = (select count(*) from prompt_bank where client_id = onboarding_progress.client_id) + (select count(*) from inserted), updated_at = now()
      where account_id = ${scope.accountId} and intent_key = ${intentKey} and lease_token = ${token}::uuid
        and client_id in (select client_id from leased)`,
  ])
}

export async function failOnboardingSeed(scope: OnboardingScope, intentKey: string, token: string, code: string) {
  const sql = db()
  await sql`update onboarding_progress set prompt_status = 'failed', error_code = ${code}, lease_token = null, lease_until = null, updated_at = now()
    where account_id = ${scope.accountId} and intent_key = ${intentKey} and lease_token = ${token}::uuid and prompt_status = 'running'`
}
