import 'server-only'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { authorizeOutcomeClient, outcomeErrorResponse, outcomeHeaders } from './guard'
import { OutcomeError, object, parseAnalyticsBatch, parseCluster, parseDeployment, parseIndexNow, parseOutcomeWindow } from './input'
import { readOutcomeBody, readOutcomeJson } from './request'
import { verifyOutcomeSignature } from './signature'
import { createOutcomeCredential, listOutcomeCredentials, revokeOutcomeCredential, parseCredentialInput, loadOutcomeCredential, consumeOutcomeRate } from './credentials'
import { ingestAnalytics, readOutcomeData, recordOutcomeDeployment, saveCluster } from './store'
import { submitIndexNow } from './indexnow'
import { loadOutcomeMeasurements, loadOutcomeSummary } from './measurements'
import { attributeOutcomeClusters } from './attribution'

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: outcomeHeaders })
export async function readOutcomes(clientId: string, request: Request) {
  try {
    const { scope } = await authorizeOutcomeClient(clientId)
    const window = parseOutcomeWindow(new URL(request.url).searchParams)
    const data = await readOutcomeData(scope, window)
    if (!data) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
    const measurements = await loadOutcomeMeasurements(scope, window)
    return json({ ...data, ...measurements, clusterOutcomes: attributeOutcomeClusters(data.clusters, measurements.queries, data.analytics), window,
      evidenceClasses: ['technical_readiness', 'observed_retrieval', 'observed_outcomes'] })
  } catch (error) { return outcomeErrorResponse(error) }
}
export async function mutateOutcomes(clientId: string, action: string, request: Request) {
  try {
    const { scope, client, profile } = await authorizeOutcomeClient(clientId)
    const raw = await readOutcomeJson(request), domain = client.domain ?? ''
    if (action === 'clusters') return json(await saveCluster(scope, parseCluster(raw, domain)), 201)
    if (action === 'deployments') return json(await recordOutcomeDeployment(scope, parseDeployment(raw, domain)), 201)
    if (action === 'indexnow') return json(await submitIndexNow(scope, parseIndexNow(raw, domain)))
    if (action === 'credentials') return json(await createOutcomeCredential(scope, profile.id, parseCredentialInput(raw)), 201)
    if (action === 'indexnow-key') {
      object(raw, [])
      const sql = db(), key = randomBytes(16).toString('hex')
      // An explicit action creates a public verification file key, never a GET.
      const [saved] = await sql`insert into outcome_integration_settings(account_id,client_id,indexnow_key,bound_domain)
        select c.account_id,c.id,${key},c.domain from clients c where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid
        on conflict(account_id,client_id) do update set indexnow_key=case when outcome_integration_settings.bound_domain=excluded.bound_domain
          then coalesce(outcome_integration_settings.indexnow_key,excluded.indexnow_key) else excluded.indexnow_key end,
          bound_domain=excluded.bound_domain,updated_at=clock_timestamp() returning indexnow_key`
      if (!saved) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
      return json({ key: saved.indexnow_key })
    }
    throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
  } catch (error) { return outcomeErrorResponse(error) }
}
export async function readCredentials(clientId: string) {
  try { const { scope } = await authorizeOutcomeClient(clientId); return json({ credentials: await listOutcomeCredentials(scope) }) }
  catch (error) { return outcomeErrorResponse(error) }
}
export async function readOutcomeSummary(clientId: string) {
  try { const { scope } = await authorizeOutcomeClient(clientId); return json(await loadOutcomeSummary(scope)) }
  catch (error) { return outcomeErrorResponse(error) }
}
export async function revokeCredential(clientId: string, credentialId: string) {
  try { const { scope } = await authorizeOutcomeClient(clientId); await revokeOutcomeCredential(scope, credentialId); return json({ revoked: true }) }
  catch (error) { return outcomeErrorResponse(error) }
}

/** Signed connector gate. No caller-supplied account or client is accepted. */
export async function ingestOutcomeRequest(request: Request, kind: 'analytics' | 'deployments') {
  try {
    if (!isFeatureEnabled('outcome_integrations')) throw new OutcomeError('OUTCOME_NOT_FOUND', 404)
    const credential = await loadOutcomeCredential(request.headers.get('x-aiso-key-id') ?? '')
    if (!credential || !credential.scopes.includes(kind)) throw new OutcomeError('UNAUTHENTICATED', 401)
    const body = await readOutcomeBody(request)
    if (!verifyOutcomeSignature(credential.secret, request.headers.get('x-aiso-timestamp') ?? '', body, request.headers.get('x-aiso-signature') ?? '')) throw new OutcomeError('UNAUTHENTICATED', 401)
    let raw: unknown
    try { raw = JSON.parse(body) } catch { throw new OutcomeError('INVALID_OUTCOME_INPUT') }
    // Validate before reserving rate capacity or writing any business data.
    const input = kind === 'analytics' ? parseAnalyticsBatch(raw, credential.domain) : parseDeployment(raw, credential.domain)
    await consumeOutcomeRate(credential.scope, credential.id)
    if ('events' in input) return json(await ingestAnalytics(credential.scope, input.events))
    return json(await recordOutcomeDeployment(credential.scope, input), 201)
  } catch (error) { return outcomeErrorResponse(error) }
}
