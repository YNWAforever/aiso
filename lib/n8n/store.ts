import { db } from '@/lib/db'
import { capabilityHash, digest, presentSummaryReceipt, readSummaryReceipt,
  type DispatchOutcome, type ExecutionIdentity, type SummaryCompletion, type SummaryReceipt, type SummaryScope } from './schema'

/** Scope values are routing hints; the scan-bound capability is the POST authority. */
async function readScoped(scope: SummaryScope, token: string) {
  const [row] = await db()`select results->'_n8n' as receipt from scans
    where id=${scope.scanId}::uuid and account_id is not distinct from ${scope.accountId}::uuid
      and client_id is not distinct from ${scope.clientId}::uuid
      and results#>>'{_n8n,tokenHash}'=${capabilityHash(token)}`
  return readSummaryReceipt(row?.receipt)
}
export async function readOwnedSummary(scope: { scanId: string; accountId: string }) {
  const [row] = await db()`select results->'_n8n' as receipt from scans
    where id=${scope.scanId}::uuid and account_id=${scope.accountId}::uuid`
  if (!row) return null
  const receipt = readSummaryReceipt(row.receipt)
  return receipt ? presentSummaryReceipt(receipt) : { state: 'not_recorded' as const, executionVerified: false }
}
export async function beginSummaryDispatch(scope: SummaryScope, token: string) {
  const rows = await db()`update scans set results=jsonb_set(results,'{_n8n,dispatch}',
      jsonb_build_object('state','sending','httpStatus',null,'observedAt',${new Date().toISOString()}::text))
    where id=${scope.scanId}::uuid and account_id is not distinct from ${scope.accountId}::uuid
      and client_id is not distinct from ${scope.clientId}::uuid
      and results#>>'{_n8n,tokenHash}'=${capabilityHash(token)}
      and results#>>'{_n8n,state}'='queued'
      and (results#>>'{_n8n,expiresAt}')::timestamptz>clock_timestamp()
      and results#>>'{_n8n,dispatch,state}'='pending' returning id`
  return rows.length === 1
}
export async function recordSummaryDispatch(scope: SummaryScope, token: string, outcome: DispatchOutcome) {
  // Only the dispatch subdocument changes; a fast completion callback wins independently.
  await db()`update scans set results=jsonb_set(results,'{_n8n,dispatch}',${JSON.stringify({ ...outcome, observedAt: new Date().toISOString() })}::jsonb)
    where id=${scope.scanId}::uuid and account_id is not distinct from ${scope.accountId}::uuid
      and client_id is not distinct from ${scope.clientId}::uuid
      and results#>>'{_n8n,tokenHash}'=${capabilityHash(token)}
      and results#>>'{_n8n,dispatch,state}' in ('sending','outcome_unknown')`
}
type ExecutionResult = { status: number; mayProcess: boolean; receipt?: ReturnType<typeof presentSummaryReceipt>; input?: SummaryReceipt['input'] }
export async function beginSummaryExecution(identity: ExecutionIdentity, token: string): Promise<ExecutionResult> {
  const rows = await db()`update scans set results=jsonb_set(results,'{_n8n}',
      (results->'_n8n')||jsonb_build_object('state','running','executionId',${identity.executionId}::text,
        'workflowId',${identity.workflowId}::text,'startedAt',${new Date().toISOString()}::text))
    where id=${identity.scanId}::uuid and account_id is not distinct from ${identity.accountId}::uuid
      and client_id is not distinct from ${identity.clientId}::uuid
      and results#>>'{_n8n,tokenHash}'=${capabilityHash(token)}
      and results#>>'{_n8n,id}'=${identity.dispatchId} and results#>>'{_n8n,state}'='queued'
      and (results#>>'{_n8n,expiresAt}')::timestamptz>clock_timestamp()
    returning results->'_n8n' as receipt`
  const receipt = readSummaryReceipt(rows[0]?.receipt) ?? await readScoped(identity, token)
  if (!receipt || receipt.id !== identity.dispatchId) return { status: 404, mayProcess: false }
  if (rows.length === 1) return { status: 200, mayProcess: true, receipt: presentSummaryReceipt(receipt), input: receipt.input }
  const same = receipt.executionId === identity.executionId && receipt.workflowId === identity.workflowId
  return { status: same ? 200 : 409, mayProcess: false, receipt: presentSummaryReceipt(receipt) }
}
export async function finishSummaryExecution(identity: ExecutionIdentity, token: string, completion: SummaryCompletion) {
  const terminal = completion.phase === 'succeeded'
    ? { state: 'succeeded', completedAt: new Date().toISOString(), summary: { text: completion.summary, hash: digest(completion.summary), provider: completion.provider } }
    : { state: 'failed', completedAt: new Date().toISOString(), error: completion.error }
  // Summary and completion share one tenant/capability/execution-fenced write.
  const rows = await db()`update scans set results=jsonb_set(results,'{_n8n}',(results->'_n8n')||${JSON.stringify(terminal)}::jsonb)
    where id=${identity.scanId}::uuid and account_id is not distinct from ${identity.accountId}::uuid
      and client_id is not distinct from ${identity.clientId}::uuid
      and results#>>'{_n8n,tokenHash}'=${capabilityHash(token)}
      and results#>>'{_n8n,id}'=${identity.dispatchId} and results#>>'{_n8n,state}'='running'
      and results#>>'{_n8n,executionId}'=${identity.executionId}
      and results#>>'{_n8n,workflowId}'=${identity.workflowId}
    returning results->'_n8n' as receipt`
  const receipt = readSummaryReceipt(rows[0]?.receipt) ?? await readScoped(identity, token)
  if (!receipt || receipt.id !== identity.dispatchId) return { status: 404 }
  const same = receipt.executionId === identity.executionId && receipt.workflowId === identity.workflowId
    && (completion.phase === 'succeeded'
      ? receipt.state === 'succeeded' && receipt.summary?.hash === digest(completion.summary)
        && Object.entries(completion.provider).every(([key, value]) => receipt.summary!.provider[key as keyof typeof completion.provider] === value)
      : receipt.state === 'failed' && receipt.error === completion.error)
  return { status: rows.length || same ? 200 : 409, receipt: presentSummaryReceipt(receipt) }
}
