import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'
import { beginSummaryDispatch, recordSummaryDispatch } from './store'
import { executionKey, type SummaryReceipt, type SummaryScope } from './schema'

/** One persisted dispatch claim. Lost/invalid acknowledgements never cause an automatic resend. */
export async function dispatchScanSummary(scope: SummaryScope, token: string, receipt: SummaryReceipt, webhook: string,
  fetcher?: PublicUrlFetch) {
  if (!await beginSummaryDispatch(scope, token)) return
  const outcome: { state: 'accepted' | 'rejected' | 'outcome_unknown'; httpStatus: number | null } = { state: 'outcome_unknown', httpStatus: null }
  try {
    const send = fetcher ?? createPublicUrlFetcher({ maxRedirects: 0, maxResponseBytes: 4096, timeoutMs: 5000, allowedProtocols: ['https:'] })
    const response = await send(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, scanId: scope.scanId, accountId: scope.accountId, clientId: scope.clientId,
        dispatchId: receipt.id, token }),
      signal: AbortSignal.timeout(5000),
    })
    outcome.httpStatus = response.status
    if (!response.ok) outcome.state = 'rejected'
    else {
      const ack = await response.json() as Record<string, unknown> | null
      if (response.status === 202 && ack?.accepted === true && ack.scanId === scope.scanId && ack.dispatchId === receipt.id
        && typeof ack.executionId === 'string' && executionKey.test(ack.executionId)
        && typeof ack.workflowId === 'string' && executionKey.test(ack.workflowId)) outcome.state = 'accepted'
    }
  } catch { /* Outcome remains unknown. Never log the webhook URL, body or capability. */ }
  await recordSummaryDispatch(scope, token, outcome)
}
