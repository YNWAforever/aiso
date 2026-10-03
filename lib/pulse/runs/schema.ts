export type PulseScope = { accountId: string; clientId: string }
export type ModelVariant = { platform: string; model: string }
export type PulseRun = { id: string; scanWeek: string; manifest: Record<string, unknown> }
export type RunCoverage = { expected: number; succeeded: number; failed: number; pending: number; blocked: number; classified: number; mentioned: number; status: 'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'blocked'; coverage: number | null; mentionRate: number | null }
export type LeasedItem = PulseScope & { id: string; runId: string; scanWeek: string; token: string; fence: number; attempt: number; attemptId: string; platform: string; model: string; snapshot: { question: string; language: string | null; market: string | null; category: string | null; contextVersion?: string }; brand: { name: string; competitors: string[]; industry: string | null } }
export type ProviderEvidence = { answer: string; actualModel: string | null; requestId: string | null; promptTokens: number | null; completionTokens: number | null; costUsd: number | null; httpStatus: number | null }
export type AttemptOutput = { kind: 'succeeded'; evidence: ProviderEvidence } | { kind: 'failed' | 'blocked'; errorCode: string; httpStatus?: number | null }
export function coverageFromCounts(counts: Omit<RunCoverage, 'status' | 'coverage' | 'mentionRate'>): RunCoverage {
  const { expected, succeeded, failed, pending, blocked, classified, mentioned } = counts
  if ([expected,succeeded,failed,pending,blocked,classified,mentioned].some(n => !Number.isSafeInteger(n) || n < 0)
    || expected !== succeeded + failed + pending + blocked || classified > succeeded || mentioned > classified) throw new Error('Invalid Pulse coverage')
  const status = expected > 0 && succeeded === expected ? 'completed' : expected > 0 && blocked === expected ? 'blocked'
    : expected > 0 && failed === expected ? 'failed' : succeeded || failed || blocked ? 'partial' : pending ? 'queued' : 'blocked'
  return { ...counts, status, coverage: expected ? succeeded / expected : null, mentionRate: classified ? mentioned / classified : null }
}
