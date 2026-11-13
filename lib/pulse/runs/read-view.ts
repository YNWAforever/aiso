import { coverageFromCounts } from './schema'
import type { readUserPulseOptions, UserPulseRun } from './user-dispatch'

type ServerOptions = Awaited<ReturnType<typeof readUserPulseOptions>>
export type MonitoringOptions = Pick<ServerOptions, 'prompts' | 'variants' | 'expected' | 'remaining' | 'week' | 'contextConfirmed' | 'enabled' | 'search' | 'latest' | 'legacyObservationIds'> & Partial<Pick<ServerOptions, 'currentCanonicalId' | 'models' | 'legacyCurrentWeek'>>
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const week = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 50 && value.every(id => typeof id === 'string' && uuid.test(id))
function unavailable(): never { throw new Error('PULSE_STATUS_UNAVAILABLE') }

/** Validate remote counts before displaying or deriving an executable action. Unknown never becomes zero. */
export function readMonitoringRun(value: unknown): UserPulseRun {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id) || !week(value.week)
    || !['canonical', 'retest'].includes(String(value.purpose)) || typeof value.retryable !== 'boolean'
    || !record(value.coverage) || !Array.isArray(value.reasons) || value.reasons.some(reason => typeof reason !== 'string')
    || value.sourceRunId != null && (typeof value.sourceRunId !== 'string' || !uuid.test(value.sourceRunId))
    || value.classificationRepairIds !== undefined && !ids(value.classificationRepairIds)) return unavailable()
  const c = value.coverage
  const keys = ['expected', 'succeeded', 'failed', 'pending', 'blocked', 'classified', 'mentioned'] as const
  if (!keys.every(key => count(c[key]))) return unavailable()
  const coverage = coverageFromCounts(c as unknown as Parameters<typeof coverageFromCounts>[0])
  if (c.status !== coverage.status && !(c.status === 'running' && coverage.status === 'queued')) return unavailable()
  if (c.status === 'running') coverage.status = 'running'
  return { id: value.id, week: value.week, purpose: value.purpose as UserPulseRun['purpose'], sourceRunId: (value.sourceRunId ?? null) as string | null, coverage, reasons: value.reasons as string[], retryable: value.retryable, observedAt: typeof value.observedAt === 'string' ? value.observedAt : null, classificationRepairIds: value.classificationRepairIds as string[] | undefined }
}

export function readMonitoringOptions(value: unknown): MonitoringOptions {
  if (!record(value) || !['prompts', 'variants', 'expected', 'remaining'].every(key => count(value[key]))
    || !week(value.week) || typeof value.contextConfirmed !== 'boolean' || typeof value.enabled !== 'boolean'
    || !ids(value.legacyObservationIds) || !record(value.search) || !['off', 'subject_to_allowance'].includes(String(value.search.requested))
    || value.currentCanonicalId != null && (typeof value.currentCanonicalId !== 'string' || !uuid.test(value.currentCanonicalId))
    || value.legacyCurrentWeek !== undefined && typeof value.legacyCurrentWeek !== 'boolean') return unavailable()
  if (value.expected !== Number(value.prompts) * Number(value.variants)) return unavailable()
  if (value.models !== undefined && (!Array.isArray(value.models) || value.models.some(model => !record(model) || typeof model.platform !== 'string' || typeof model.model !== 'string'))) return unavailable()
  return { ...value, latest: value.latest == null ? null : readMonitoringRun(value.latest) } as MonitoringOptions
}
