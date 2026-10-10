import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { readActivation } from '@/lib/telemetry/activation'
import { buildActivationProgress } from '@/lib/view-models/activation-progress'
import { importSource, approveSourceVersion, revokeSource } from '@/lib/sources/store'

vi.mock('server-only', () => ({}))

// Included in the DEFAULT guarded disposable config. No caller-selected C9 target.
const sql = neon(process.env.TEST_DATABASE_URL!)
const accountId = randomUUID(), otherId = randomUUID(), actorId = randomUUID(), otherActorId = randomUUID()
let clientId: string
const scope = () => ({ accountId, clientId, actorId })
const input = (answer = 'Synthetic answer') => ({
  sourceKey: 'approval-milestone', kind: 'facts' as const, label: 'Synthetic milestone',
  entries: [{ question: 'Synthetic question?', answer }], importMethod: 'paste' as const,
  originRef: null, approve: false,
})

beforeAll(async () => {
  const [identity] = await sql`select current_setting('neon.project_id') as project, current_setting('neon.branch_id') as branch, current_user as role`
  expect(identity!.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
  vi.stubEnv('DATABASE_URL', process.env.TEST_DATABASE_URL!)
  vi.stubEnv('EXPECTED_NEON_BRANCH_ID', identity!.branch as string)
  vi.stubEnv('EXPECTED_DB_ROLE', identity!.role as string)
  await sql`insert into accounts (id, plan, status) values (${accountId}, 'pro', 'active'), (${otherId}, 'pro', 'active')`
  await sql`insert into neon_auth.user (id, email, name, "emailVerified") values (${actorId}, ${`${actorId}@example.test`}, 'Synthetic activation', false)`
  await sql`insert into profiles (id, account_id, display_name) values (${actorId}, ${accountId}, 'Synthetic activation')`
  await sql`insert into neon_auth.user (id, email, name, "emailVerified") values (${otherActorId}, ${`${otherActorId}@example.test`}, 'Synthetic other', false)`
  await sql`insert into profiles (id, account_id, display_name) values (${otherActorId}, ${otherId}, 'Synthetic other')`
  const [client] = await sql`insert into clients (account_id, brand_name, status, competitors) values (${accountId}, 'Synthetic activation', 'active', ${[]}::text[]) returning id`
  clientId = client!.id as string
  await sql`insert into scans (account_id, url, domain, score, results) values (${accountId}, 'https://example.test', 'example.test', 0, '{}'::jsonb)`
})

beforeEach(async () => {
  await sql`delete from client_source_versions where account_id in (${accountId}, ${otherId})`
  await sql`delete from client_sources where account_id in (${accountId}, ${otherId})`
})

afterAll(async () => {
  await sql`delete from client_source_versions where account_id in (${accountId}, ${otherId})`
  await sql`delete from client_sources where account_id in (${accountId}, ${otherId})`
  await sql`delete from scans where account_id = ${accountId}`
  await sql`delete from clients where account_id in (${accountId}, ${otherId})`
  await sql`delete from profiles where account_id in (${accountId}, ${otherId})`
  await sql`delete from neon_auth.user where id in (${actorId}, ${otherActorId})`
  await sql`delete from accounts where id in (${accountId}, ${otherId})`
})

async function imported(answer?: string) {
  const result = await importSource(scope(), input(answer))
  if (!('source' in result)) throw new Error('Synthetic import failed')
  return result.source
}
async function approve(source: Awaited<ReturnType<typeof imported>>) {
  const result = await approveSourceVersion(scope(), {
    sourceId: source.id, versionId: source.current!.id,
    expectedLatestVersion: source.latestVersion, expectedContentHash: source.current!.contentHash,
  })
  if (!('source' in result)) throw new Error('Synthetic approval failed')
  return result
}

it('unapproved_source_does_not_complete_approval_milestone', async () => {
  await imported()
  const activation = await readActivation(accountId)
  expect(activation.reached.first_source).toBeNull()
  expect(activation.furthest).toBe('first_workspace')
  expect(buildActivationProgress(activation)).toMatchObject({ reached: 2, total: 6, next: 'first_source' })
})

it('first approval uses approved_at and does not grant agent permission', async () => {
  const result = await approve(await imported())
  expect(result.kind).toBe('approved')
  expect(result.source.agentUseAllowed).toBe(false)
  expect(result.source.current!.approvedAt).not.toBeNull()
  expect((await readActivation(accountId)).reached.first_source).toBe(result.source.current!.approvedAt)
})

it('repeat approval, newer versions, later approval and withdrawal retain the first event', async () => {
  const first = await approve(await imported())
  const timestamp = first.source.current!.approvedAt
  const repeat = await approve(first.source)
  expect(repeat.kind).toBe('already-approved')
  expect(repeat.source.current!.approvedAt).toBe(timestamp)
  const next = await imported('Changed synthetic answer')
  expect(next.latestVersion).toBe(2)
  expect(next.current!.approvedAt).toBeNull()
  expect((await readActivation(accountId)).reached.first_source).toBe(timestamp)
  await approve(next)
  expect((await readActivation(accountId)).reached.first_source).toBe(timestamp)
  await revokeSource(scope(), next.id)
  expect((await readActivation(accountId)).reached.first_source).toBe(timestamp)
})

it('another account approval never completes this account milestone', async () => {
  await imported()
  const [otherClient] = await sql`insert into clients (account_id, brand_name, status) values (${otherId}, 'Synthetic other', 'active') returning id`
  const other = await importSource({ accountId: otherId, clientId: otherClient!.id as string, actorId: otherActorId }, { ...input(), approve: true })
  expect(other.kind).toBe('created')
  if (!('source' in other)) throw new Error('Synthetic other import failed')
  expect(other.source.current!.approvedAt).not.toBeNull()
  expect((await readActivation(accountId)).reached.first_source).toBeNull()
})
