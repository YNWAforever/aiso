import type { FactualDensityResult } from '@/lib/types'

// Shared by client rendering and server projections. Stored legacy rows lack
// uniquenessStatus; their numeric 50 cannot establish provider provenance.
export type FactualDensityView = Partial<FactualDensityResult>
export type FactualDensityState = 'observed' | 'unavailable' | 'legacy'
export const FACTUAL_DENSITY_VERSION = '2026-10-07.v1'
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100

export function factualDensityState(value: unknown, diagnostic?: { collection?: string }): FactualDensityState {
  const data = object(value)
  if (!data.uniquenessStatus) return 'legacy'
  return data.uniquenessStatus === 'observed' && score(data.qualityScore)
    && typeof data.uniquenessScore === 'number' && Number.isInteger(data.uniquenessScore) && score(data.uniquenessScore)
    && (!diagnostic || diagnostic.collection === 'complete') ? 'observed' : 'unavailable'
}

/** A read projection only: never rewrites a historical envelope or its signature. */
export function projectFactualDensityChecks<T extends Record<string, unknown>>(checks: T, results?: Record<string, unknown>): T {
  const check = object(checks.c18_factual_density)
  if (!Object.keys(check).length) return checks
  const raw = object(results?.c18_factual_density)
  const data = results?.c18_factual_density_data ?? results?.c18 ?? raw.geoDetails
  const oldVersion = typeof check.version === 'string' && check.version !== FACTUAL_DENSITY_VERSION
  if (!oldVersion && (!results || factualDensityState(data, raw.diagnostic as { collection?: string } | undefined) === 'observed')) return checks
  return { ...checks, c18_factual_density: { ...check, collection: 'partial', applicability: 'not-verifiable', assessment: 'not-verifiable' } }
}
