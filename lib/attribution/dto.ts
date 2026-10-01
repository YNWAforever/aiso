import type { EnquiryResult, Figure, TargetResult, TargetStatus } from './types'
import type { DayRange } from './windows'

/**
 * The browser's reading of the GET body (spec 5.2). Pure and free of
 * `server-only`, so a client component can import it; the server's own
 * `AttributionResponse` (service.ts) is the other side of this contract.
 * Anything off-shape throws, and the block then shows its "unavailable" copy:
 * a half-understood measurement is never rendered as a plausible one.
 */

export const TARGET_STATUSES = [
  'withdrawn',
  'not_supported',
  'not_measured',
  'unavailable',
  'not_ready',
  'insufficient_history',
  'comparable',
] as const satisfies readonly TargetStatus[]

export type AttributionTargetView = TargetResult & {
  scope: 'site' | 'page' | null
  asset?: { id: string; url: string; label: string }
}

export type AttributionView = {
  deliveredOn: string | null
  windows: { before: DayRange; after: DayRange } | null
  readyOn: string | null
  targets: AttributionTargetView[]
}

function reject(): never {
  throw new TypeError('Invalid attribution response')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject()
  return value as Record<string, unknown>
}

const str = (value: unknown): string => (typeof value === 'string' ? value : reject())
const nullableStr = (value: unknown): string | null => (value === null ? null : str(value))
const nullableNum = (value: unknown): number | null =>
  value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : reject()

function figure(value: unknown): Figure {
  const f = record(value)
  const pct = f.changePct
  if (pct !== null && pct !== 'new' && !(typeof pct === 'number' && Number.isFinite(pct))) reject()
  return { before: nullableNum(f.before), after: nullableNum(f.after), change: nullableNum(f.change), changePct: pct }
}

function range(value: unknown): DayRange {
  const r = record(value)
  return { from: str(r.from), to: str(r.to) }
}

function status(value: unknown): TargetStatus {
  return (TARGET_STATUSES as readonly unknown[]).includes(value) ? (value as TargetStatus) : reject()
}

/** The fields every verdict carries, whichever source it is for. */
function verdict(r: Record<string, unknown>) {
  return {
    status: status(r.status),
    ...(r.reason !== undefined ? { reason: str(r.reason) } : {}),
    ...(r.readyOn !== undefined ? { readyOn: str(r.readyOn) } : {}),
    ...(r.missingFrom !== undefined ? { missingFrom: str(r.missingFrom) } : {}),
    ...(r.missingTo !== undefined ? { missingTo: str(r.missingTo) } : {}),
  }
}

function enquiries(value: unknown): EnquiryResult {
  const r = record(value)
  const out: EnquiryResult = verdict(r)
  for (const key of ['total', 'organic_search', 'ai_assistant', 'other'] as const) {
    if (r[key] !== undefined) out[key] = figure(r[key])
  }
  if (r.withheld !== undefined) out.withheld = typeof r.withheld === 'boolean' ? r.withheld : reject()
  return out
}

function target(value: unknown): AttributionTargetView {
  const r = record(value)
  const scope = r.scope
  if (scope !== 'site' && scope !== 'page' && scope !== null) reject()
  const out: AttributionTargetView = { scope, ...verdict(r) }
  if (r.asset !== undefined) {
    const a = record(r.asset)
    out.asset = { id: str(a.id), url: str(a.url), label: str(a.label) }
  }
  if (r.search !== undefined) {
    const s = record(r.search)
    out.search = { clicks: figure(s.clicks), impressions: figure(s.impressions), ctr: figure(s.ctr), position: figure(s.position) }
  }
  if (r.enquiries !== undefined) out.enquiries = enquiries(r.enquiries)
  return out
}

export function parseAttributionResponse(value: unknown): AttributionView {
  const r = record(value)
  if (!Array.isArray(r.targets) || r.targets.length > 64) return reject()
  return {
    deliveredOn: nullableStr(r.deliveredOn),
    windows: r.windows === null ? null : { before: range(record(r.windows).before), after: range(record(r.windows).after) },
    readyOn: nullableStr(r.readyOn),
    targets: r.targets.map(target),
  }
}
