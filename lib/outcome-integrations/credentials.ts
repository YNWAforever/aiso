import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { sealToken, openToken } from '@/lib/integrations/google/vault'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { OutcomeError, UUID, object, text } from './input'
import type { OutcomeScope } from './store'

export function parseCredentialInput(raw: unknown) {
  const body = object(raw, ['name', 'scopes'])
  if (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > 2 || body.scopes.some(scope => !['analytics', 'deployments'].includes(scope))) throw new OutcomeError('INVALID_OUTCOME_INPUT')
  return { name: text(body.name, 100), scopes: [...new Set(body.scopes)] as string[] }
}
export async function createOutcomeCredential(scope: OutcomeScope, creator: string, input: { name: string; scopes: string[] }) {
  const sql = db(), id = randomUUID(), secret = randomBytes(32).toString('base64url')
  const sealed = sealToken(secret, { accountId: scope.accountId, purpose: `outcome-key:${id}` })
  const rows = await sql`insert into outcome_ingest_credentials(id,account_id,client_id,created_by,name,scopes,token_ciphertext,token_key_id)
    select ${id}::uuid,c.account_id,c.id,p.id,${input.name},${input.scopes}::text[],decode(${sealed.ciphertext.toString('hex')},'hex'),${sealed.keyId}
    from clients c join profiles p on p.account_id=c.account_id where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid
      and p.id=${creator}::uuid and p.deactivated_at is null returning id`
  if (!rows.length) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
  return { id, secret, name: input.name, scopes: input.scopes }
}
export async function listOutcomeCredentials(scope: OutcomeScope) {
  const sql = db()
  return sql`select id,name,scopes,created_at,revoked_at from outcome_ingest_credentials where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc limit 50`
}
export async function revokeOutcomeCredential(scope: OutcomeScope, id: string) {
  if (!UUID.test(id)) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
  const sql = db()
  const rows = await sql`update outcome_ingest_credentials set revoked_at=coalesce(revoked_at,clock_timestamp())
    where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${id}::uuid returning id`
  if (!rows.length) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
}
/** Opaque key lookup establishes scope; payloads never select a tenant. */
export async function loadOutcomeCredential(id: string) {
  if (!UUID.test(id)) return null
  const sql = db()
  const [row] = await sql`select k.id,k.account_id,k.client_id,k.scopes,k.token_ciphertext,k.token_key_id,c.domain,
      jsonb_build_object('plan',a.plan,'status',a.status,'stripe_subscription_id',a.stripe_subscription_id,
        'trial_ends_at',a.trial_ends_at,'override_plan',a.override_plan,'override_expires_at',a.override_expires_at) as commercial
    from outcome_ingest_credentials k join clients c on c.id=k.client_id and c.account_id=k.account_id
    join profiles p on p.id=k.created_by and p.account_id=k.account_id and p.deactivated_at is null
    join accounts a on a.id=k.account_id where k.id=${id}::uuid and k.revoked_at is null`
  if (!row || !resolveCommercialEntitlement(row.commercial as CommercialAccount).features.outcome_integrations) return null
  const scope = { accountId: String(row.account_id), clientId: String(row.client_id) }
  return { id, scope, domain: String(row.domain), scopes: row.scopes as string[],
    secret: openToken({ ciphertext: Buffer.from(row.token_ciphertext), keyId: String(row.token_key_id) }, { accountId: scope.accountId, purpose: `outcome-key:${id}` }) }
}
/** Atomic sliding minute bucket. Replays consume capacity as well. */
export async function consumeOutcomeRate(scope: OutcomeScope, id: string) {
  const sql = db()
  const rows = await sql`update outcome_ingest_credentials k set
    rate_count=case when rate_window>clock_timestamp()-interval '1 minute' then rate_count+1 else 1 end,
    rate_window=case when rate_window>clock_timestamp()-interval '1 minute' then rate_window else clock_timestamp() end
    where k.id=${id}::uuid and k.account_id=${scope.accountId}::uuid and k.client_id=${scope.clientId}::uuid and k.revoked_at is null
      and exists(select 1 from profiles p where p.id=k.created_by and p.account_id=k.account_id and p.deactivated_at is null)
      and (rate_window is null or rate_window<=clock_timestamp()-interval '1 minute' or rate_count<60) returning id`
  if (!rows.length) throw new OutcomeError('OUTCOME_RATE_LIMITED', 429)
}
