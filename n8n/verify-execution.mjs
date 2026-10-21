import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Compare a retained AISO receipt with one authenticated, read-only n8n execution response. */
export function verifyExecutionReceipt(saved, execution) {
  const receipt = saved?.receipt
  const fail = reason => ({ verified: false, reason })
  const key = /^[a-zA-Z0-9_-]{1,80}$/
  if (!saved?.scanId || !receipt || !key.test(receipt.executionId ?? '') || !key.test(receipt.workflowId ?? '')
    || !['succeeded', 'failed'].includes(receipt.state)) return fail('RECEIPT_NOT_TERMINAL')
  if (String(execution?.id) !== receipt.executionId || execution?.workflowId !== receipt.workflowId) return fail('EXECUTION_IDENTITY_MISMATCH')
  const expectedStatus = receipt.state === 'succeeded' ? 'success' : 'error'
  if (execution.status !== expectedStatus || !Number.isFinite(Date.parse(execution.startedAt))
    || !Number.isFinite(Date.parse(execution.stoppedAt))) return fail('EXECUTION_NOT_CONFIRMED_TERMINAL')
  const runs = execution.data?.resultData?.runData?.['Persist Summary']
  const output = Array.isArray(runs) ? runs.flatMap(run => run?.data?.main?.[0] ?? [])
    .map(item => item?.json).find(value => value?.scanId === saved.scanId) : null
  const observed = output?.receipt
  if (!observed || observed.id !== receipt.id || observed.executionId !== receipt.executionId
    || observed.workflowId !== receipt.workflowId || observed.snapshotHash !== receipt.snapshotHash
    || observed.state !== receipt.state
    || (receipt.state === 'succeeded' ? !receipt.summary?.hash || observed.summary?.hash !== receipt.summary.hash : observed.error !== receipt.error)) {
    return fail('SAVED_OUTPUT_BINDING_MISMATCH')
  }
  return { verified: true, verification: 'execution-data-matched', scanId: saved.scanId, dispatchId: receipt.id,
    executionId: receipt.executionId, workflowId: receipt.workflowId, state: receipt.state, n8nStatus: execution.status,
    startedAt: execution.startedAt, stoppedAt: execution.stoppedAt, snapshotHash: receipt.snapshotHash,
    summaryHash: receipt.summary?.hash ?? null, checkedAt: new Date().toISOString() }
}

async function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--receipt')
  if (at < 0 || !args[at + 1]) throw new Error('Pass --receipt <saved-owner-GET-response.json>')
  const saved = JSON.parse(readFileSync(args[at + 1], 'utf8'))
  const id = saved?.receipt?.executionId
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('RECEIPT_EXECUTION_ID_REQUIRED')
  if (!process.env.N8N_API_KEY) throw new Error('N8N_API_KEY_REQUIRED_NO_REQUEST_SENT')
  const base = new URL(process.env.N8N_API_BASE_URL || 'https://anfield-n8n.zeabur.app/api/v1/')
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || !/^\/api\/v1\/?$/.test(base.pathname)) throw new Error('INVALID_N8N_API_BASE_URL')
  base.pathname = '/api/v1/executions/' + encodeURIComponent(id)
  base.searchParams.set('includeData', 'true')
  const response = await fetch(base, { method: 'GET', redirect: 'error',
    headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('N8N_EXECUTION_READ_FAILED_' + response.status)
  const reader = response.body?.getReader(), chunks = []
  let length = 0
  if (!reader) throw new Error('N8N_EXECUTION_BODY_MISSING')
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 2_000_000) { await reader.cancel(); throw new Error('N8N_EXECUTION_RESPONSE_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const proof = { ...verifyExecutionReceipt(saved, JSON.parse(Buffer.concat(chunks).toString('utf8'))), source: 'authenticated-n8n-api' }
  const outputAt = args.indexOf('--output')
  if (outputAt >= 0 && args[outputAt + 1]) writeFileSync(args[outputAt + 1], JSON.stringify(proof, null, 2) + '\n')
  console.log(JSON.stringify(proof, null, 2))
  if (!proof.verified) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print remote bodies, URLs, API keys or raw execution data.
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'EXECUTION_VERIFICATION_UNAVAILABLE'
    console.error(code)
    process.exitCode = 1
  })
}
