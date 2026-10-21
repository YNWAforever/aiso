import { createHash, randomBytes, randomUUID } from 'node:crypto'

export type SummaryScope = { scanId: string; accountId: string | null; clientId: string | null }
export type ExecutionIdentity = SummaryScope & { dispatchId: string; executionId: string; workflowId: string }
export type SummaryInput = { domain: string; score: number; grade: string; checks: { id: string; status: string; message: string }[] }
export type SummaryProvider = { httpStatus: number; actualModel: string | null; requestId: string | null;
  promptTokens: number | null; completionTokens: number | null; costUsd: number | null }
export type SummaryFailure = 'PROVIDER_FAILED' | 'EMPTY_SUMMARY' | 'EXECUTION_FAILED' | 'NO_SOURCED_CHECKS'
export type SummaryCompletion = { phase: 'succeeded'; summary: string; provider: SummaryProvider }
  | { phase: 'failed'; error: SummaryFailure }
export type DispatchOutcome = { state: 'pending' | 'sending' | 'accepted' | 'rejected' | 'outcome_unknown'; httpStatus: number | null; observedAt?: string }
export type SummaryReceipt = {
  version: 1; id: string; tokenHash: string; snapshotHash: string; input: SummaryInput
  state: 'queued' | 'running' | 'succeeded' | 'failed'
  createdAt: string; expiresAt: string; dispatch: DispatchOutcome
  executionId?: string; workflowId?: string; startedAt?: string; completedAt?: string
  summary?: { text: string; hash: string; provider: SummaryProvider }
  error?: SummaryFailure
}
export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export const executionKey = /^[a-zA-Z0-9_-]{1,80}$/
export const tokenPattern = /^[0-9a-f]{64}$/
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const capabilityHash = (token: string) => digest('aiso:n8n-summary:v1:' + token)

/** Freeze only check identifiers and findings, never raw page/provider/private metadata. */
export function createSummaryReceipt(scan: { domain: string; score: number; grade: string; results: object }, now = new Date()) {
  const raw = scan.results as Record<string, unknown>
  const evidence = object(raw.evidence) && object(raw.evidence.checks) ? raw.evidence.checks : null
  const input: SummaryInput = { domain: scan.domain, score: scan.score, grade: scan.grade,
    checks: Object.entries(scan.results).filter(([key, value]) => /^c(?:[1-9]|1\d|20)_/.test(key)
      && object(value) && ['pass', 'warn', 'fail'].includes(String(value.status))
      && (evidence ? object(evidence[key]) && evidence[key].collection === 'complete'
        && (evidence[key].assessment === undefined || ['pass', 'warn', 'fail'].includes(String(evidence[key].assessment)))
        : !object(value.diagnostic) || value.diagnostic.collection === 'complete'))
      .map(([id, value]) => ({ id, status: String(value.status), message: typeof value.message === 'string' ? value.message.slice(0, 200) : '' }))
      .sort((a, b) => a.id.localeCompare(b.id)) }
  const token = randomBytes(32).toString('hex')
  const receipt: SummaryReceipt = { version: 1, id: randomUUID(), tokenHash: capabilityHash(token),
    snapshotHash: digest(JSON.stringify(input)), input, state: input.checks.length ? 'queued' : 'failed',
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    dispatch: { state: 'pending', httpStatus: null },
    ...(!input.checks.length ? { error: 'NO_SOURCED_CHECKS' as const, completedAt: now.toISOString() } : {}) }
  return { token, receipt }
}

export function readSummaryReceipt(value: unknown): SummaryReceipt | null {
  if (!object(value) || value.version !== 1 || !uuid.test(String(value.id))
    || !tokenPattern.test(String(value.tokenHash)) || !tokenPattern.test(String(value.snapshotHash))
    || !object(value.input) || !Array.isArray(value.input.checks)
    || !['queued', 'running', 'succeeded', 'failed'].includes(String(value.state))
    || !object(value.dispatch) || !['pending', 'sending', 'accepted', 'rejected', 'outcome_unknown'].includes(String(value.dispatch.state))
    || !Number.isFinite(Date.parse(String(value.createdAt))) || !Number.isFinite(Date.parse(String(value.expiresAt)))) return null
  return value as unknown as SummaryReceipt
}

/** Callback-authenticated summary completion is distinct from an independently checked n8n execution. */
export function presentSummaryReceipt(receipt: SummaryReceipt, now = Date.now()) {
  const stale = !['succeeded', 'failed'].includes(receipt.state) && Date.parse(receipt.expiresAt) <= now
  const state = stale ? 'outcome_unknown' : receipt.state === 'queued' && receipt.dispatch.state === 'rejected'
    ? 'dispatch_failed' : receipt.state === 'queued' && receipt.dispatch.state === 'outcome_unknown' ? 'outcome_unknown' : receipt.state
  return { version: 1, id: receipt.id, state, snapshotHash: receipt.snapshotHash,
    createdAt: receipt.createdAt, expiresAt: receipt.expiresAt, dispatch: receipt.dispatch,
    executionId: receipt.executionId ?? null, workflowId: receipt.workflowId ?? null,
    startedAt: receipt.startedAt ?? null, completedAt: receipt.completedAt ?? null,
    callbackAuthenticated: !!receipt.executionId, executionVerified: false,
    summary: receipt.summary ?? null, error: receipt.error ?? null }
}

export function parseExecutionIdentity(scanId: string, value: unknown): ExecutionIdentity | null {
  if (!uuid.test(scanId) || !object(value) || !uuid.test(String(value.dispatchId))
    || typeof value.executionId !== 'string' || !executionKey.test(value.executionId)
    || typeof value.workflowId !== 'string' || !executionKey.test(value.workflowId)
    || !(value.accountId === null || typeof value.accountId === 'string' && uuid.test(value.accountId))
    || !(value.clientId === null || typeof value.clientId === 'string' && uuid.test(value.clientId))) return null
  return { scanId, accountId: value.accountId as string | null, clientId: value.clientId as string | null,
    dispatchId: String(value.dispatchId), executionId: String(value.executionId), workflowId: String(value.workflowId) }
}

export function parseSummaryCompletion(value: unknown): SummaryCompletion | null {
  if (!object(value)) return null
  if (value.phase === 'failed' && ['PROVIDER_FAILED', 'EMPTY_SUMMARY', 'EXECUTION_FAILED', 'NO_SOURCED_CHECKS'].includes(String(value.error))) {
    return { phase: 'failed', error: value.error as SummaryFailure }
  }
  if (value.phase !== 'succeeded' || typeof value.summary !== 'string' || value.summary.trim().length < 10
    || value.summary.length > 6000 || !object(value.provider) || value.provider.httpStatus !== 200) return null
  const p = value.provider
  if (!['actualModel', 'requestId'].every(key => p[key] === null || typeof p[key] === 'string' && p[key].length <= 200)
    || !['promptTokens', 'completionTokens'].every(key => p[key] === null || Number.isSafeInteger(p[key]) && Number(p[key]) >= 0)
    || !(p.costUsd === null || typeof p.costUsd === 'number' && Number.isFinite(p.costUsd) && p.costUsd >= 0)) return null
  return { phase: 'succeeded', summary: value.summary.trim(), provider: {
    httpStatus: 200, actualModel: p.actualModel as string | null, requestId: p.requestId as string | null,
    promptTokens: p.promptTokens as number | null, completionTokens: p.completionTokens as number | null, costUsd: p.costUsd as number | null } }
}
