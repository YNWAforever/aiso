import { createHash } from 'node:crypto'
import { PILLAR_SCORE_VERSION, type PillarEvidenceInputs } from '@/lib/pillar-scores'
import { SCANNER_VERSION } from '@/lib/types'

export const EVIDENCE_SCHEMA_VERSION = 1
export const HEADLINE_METHOD_VERSION = 'aiso-100.v1'
export const URL_REDACTION_VERSION = 'origin-only.v1'
export const CHECK_VERSIONS = {
  c1_robots: '2026-09-05.v1', c2_llms_txt: '2026-08-31.v1', c3_bot_access: '2026-08-31.v1',
  c4_structured_data: '2026-08-31.v1', c5_extractability: '2026-08-31.v1', c6_llms_full_txt: '2026-08-31.v1',
  c7_mcp_card: '2026-08-31.v1', c8_sitemap: '2026-08-31.v1', c9_meta_desc: '2026-08-31.v1',
  c10_headings: '2026-08-31.v1', c11_faq: '2026-08-31.v1', c12_canonical: '2026-08-31.v1',
  c13_render: '2026-08-31.v1', c14_internal_links: '2026-08-31.v1', c15_entity: '2026-08-31.v1',
  c16_freshness: '2026-08-31.v1', c17_citation_density: '2026-08-31.v1', c18_factual_density: '2026-08-31.v1',
  c19_topical_authority: '2026-08-31.v1', c20_chunkability: '2026-08-31.v1',
} as const
export type EvidenceCheckKey = keyof typeof CHECK_VERSIONS
export type CollectionState = 'complete' | 'partial' | 'blocked' | 'failed' | 'unsupported' | 'unknown'
export type EvidenceAssessment = 'pass' | 'warn' | 'fail' | 'not-applicable' | 'not-verifiable'
export type CheckDiagnostic = { collection: CollectionState; reason?: 'provider-fallback' | 'inferred-only' | 'no-input' | 'fetch-failed' | 'parse-failed' }
export interface EvidenceUrl { origin: string | null; pathRedacted: boolean; queryRedacted: boolean; fragmentRedacted: boolean; originNormalized: boolean }
export interface EvidenceObservation { observedAt?: string; provenance?: 'validated-fetch'; collection: CollectionState; target: EvidenceUrl; httpStatus?: number; signals?: Record<string, boolean | number | string>; check?: EvidenceCheckKey | 'page' | 'sitemap' }
type CheckEvidence = { applicability: 'applicable' | 'not-applicable' | 'not-verifiable'; version: string; collection: CollectionState; assessment: EvidenceAssessment; reason?: CheckDiagnostic['reason'] }
const states: readonly string[] = ['complete', 'partial', 'blocked', 'failed', 'unsupported', 'unknown']
const assessments: readonly string[] = ['pass', 'warn', 'fail', 'not-applicable', 'not-verifiable']
const reasons: readonly string[] = ['provider-fallback', 'inferred-only', 'no-input', 'fetch-failed', 'parse-failed']
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]))
  return value
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function describeEvidenceUrl(input: unknown): EvidenceUrl {
  try {
    const url = new URL(String(input))
    if (!['http:', 'https:'].includes(url.protocol) || url.origin.length > 300) throw new Error()
    return { origin: url.origin, pathRedacted: url.pathname !== '/', queryRedacted: !!url.search, fragmentRedacted: !!url.hash, originNormalized: url.pathname !== '/' || !!url.search || !!url.hash || !!url.username || !!url.password }
  } catch { return { origin: null, pathRedacted: true, queryRedacted: true, fragmentRedacted: true, originNormalized: true } }
}
function normalizeDescriptor(value: unknown): EvidenceUrl {
  const data = object(value)
  const safe = describeEvidenceUrl(data.origin)
  return { origin: safe.origin, pathRedacted: data.pathRedacted === true, queryRedacted: data.queryRedacted === true, fragmentRedacted: data.fragmentRedacted === true, originNormalized: data.originNormalized === true }
}
export function parsedHeaderSignals(headers: Headers): Record<string, string | number | boolean> {
  const signals: Record<string, string | number | boolean> = {}
  const mime = headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (mime && ['text/html', 'text/plain', 'application/json', 'application/xml', 'text/xml', 'application/xhtml+xml'].includes(mime)) signals.mimeType = mime
  const length = headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number.isSafeInteger(Number(length))) signals.contentLength = Number(length)
  const modified = headers.get('last-modified')
  if (modified && Number.isFinite(Date.parse(modified))) signals.lastModified = new Date(modified).toISOString()
  const robots = headers.get('x-robots-tag')?.toLowerCase().split(/[,:\s]+/) ?? []
  for (const key of ['noindex', 'nofollow', 'nosnippet', 'noarchive']) if (robots.includes(key)) signals[key] = true
  return signals
}
function normalizeSignals(value: unknown) {
  const input = object(value), result: Record<string, string | number | boolean> = {}
  for (const key of ['mimeType', 'contentLength', 'lastModified', 'noindex', 'nofollow', 'nosnippet', 'noarchive']) {
    const v = input[key]
    if (key === 'contentLength' && typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) result[key] = v
    if (['noindex', 'nofollow', 'nosnippet', 'noarchive'].includes(key) && typeof v === 'boolean') result[key] = v
    if (key === 'mimeType' && typeof v === 'string' && ['text/html','text/plain','application/json','application/xml','text/xml','application/xhtml+xml'].includes(v)) result[key] = v
    if (key === 'lastModified' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v))) result[key] = v
    if (key in result && bytes(result[key]) > 512) delete result[key]
  }
  return result
}
export interface EvidenceInput {
  requestedUrl: string; evaluatedUrl: string; industry: unknown; region: unknown;
  sitemapSource: unknown; checks: Partial<Record<EvidenceCheckKey, { assessment?: unknown; collection?: unknown; reason?: unknown }>>;
  observations?: unknown[]; collectedAt?: string; limited?: boolean;
}
const supportedPillarMethods = ['2026-08-26.v1', PILLAR_SCORE_VERSION] as const
export function buildScanEvidence(input: EvidenceInput) {
  return buildEvidenceForMethod(input, PILLAR_SCORE_VERSION)
}
function buildEvidenceForMethod(input: EvidenceInput, pillarMethod: string) {
  const requested = describeEvidenceUrl(input.requestedUrl), evaluated = describeEvidenceUrl(input.evaluatedUrl)
  const checks = {} as Record<EvidenceCheckKey, CheckEvidence>
  for (const key of Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]) {
    const record = input.checks[key]
    const collection: CollectionState = typeof record?.collection === 'string' && states.includes(record.collection) ? record.collection as CollectionState : 'unknown'
    const assessment: EvidenceAssessment = typeof record?.assessment === 'string' && assessments.includes(record.assessment) ? record.assessment as EvidenceAssessment : 'not-verifiable'
    checks[key] = {
      applicability: assessment === 'not-applicable' ? 'not-applicable' : assessment === 'not-verifiable' || !['complete','partial'].includes(collection) ? 'not-verifiable' : 'applicable',
      version: CHECK_VERSIONS[key], collection, assessment,
    }
    if (typeof record?.reason === 'string' && reasons.includes(record.reason)) checks[key].reason = record!.reason as CheckDiagnostic['reason']
  }
  const observations: EvidenceObservation[] = (input.observations ?? []).slice(0,40).map(raw => {
    const data = object(raw)
    const observation: EvidenceObservation = { observedAt: typeof data.observedAt === 'string' && Number.isFinite(Date.parse(data.observedAt)) ? new Date(data.observedAt).toISOString() : undefined, provenance: 'validated-fetch', collection: typeof data.collection === 'string' && states.includes(data.collection) ? data.collection as CollectionState : 'unknown', target: normalizeDescriptor(data.target) }
    if (typeof data.httpStatus === 'number' && Number.isInteger(data.httpStatus) && data.httpStatus >= 100 && data.httpStatus <= 599) observation.httpStatus = data.httpStatus
    if (typeof data.check === 'string' && (Object.hasOwn(CHECK_VERSIONS, data.check) || ['page','sitemap'].includes(data.check))) observation.check = data.check as EvidenceObservation['check']
    observation.signals = normalizeSignals(data.signals)
    return observation
  })
  const industry = typeof input.industry === 'string' && ['finance','medical','legal','technology','retail_ecommerce','travel_hospitality','education','real_estate','manufacturing','media_entertainment','energy_utilities','general_b2b','general_b2c'].includes(input.industry) ? input.industry : 'unknown'
  const region = typeof input.region === 'string' && ['HK','TW','SG','JP','KR','US','UK','EU','AU','CA','global'].includes(input.region) ? input.region : 'unknown'
  const final = observations.find(o => o.check === 'page' && o.httpStatus !== undefined)?.target ?? null
  const sitemapSource = input.sitemapSource === 'caller' || input.sitemapSource === 'fetched' ? input.sitemapSource : 'unknown'
  const comparison = { scope: 'single-origin-page' as const, evaluatedOrigin: evaluated.origin, finalOrigin: final?.origin ?? null, industry, region, sitemapSource, urlPolicy: URL_REDACTION_VERSION, scannerVersion: SCANNER_VERSION, checkVersions: CHECK_VERSIONS, headlineMethod: HEADLINE_METHOD_VERSION, pillarMethod }
  const collectedAt = typeof input.collectedAt === 'string' && Number.isFinite(Date.parse(input.collectedAt)) ? new Date(input.collectedAt).toISOString() : null
  const page = observations.find(o => o.check === 'page')
  const completedPages = page?.collection === 'complete' && page.httpStatus !== undefined && page.httpStatus < 400 ? 1 : 0
  const collection: CollectionState = Object.values(checks).every(c => c.collection === 'complete') && completedPages === 1 ? 'complete' : Object.values(checks).some(c => c.collection === 'complete' || c.collection === 'partial') || completedPages === 1 ? 'partial' : page?.collection ?? 'unknown'
  const evidence = { collection, completedPages, schemaVersion: EVIDENCE_SCHEMA_VERSION, scannerVersion: SCANNER_VERSION, headlineMethod: HEADLINE_METHOD_VERSION, pillarMethod, requestedScope: 'single-origin-page' as const, completedScope: completedPages === 1 ? 'single-origin-page' as const : 'none' as const, requested, evaluated, final, collectedAt, checks, observations, comparison, comparisonSignature: createHash('sha256').update(JSON.stringify(comparison)).digest('hex'), limited: input.limited === true || (input.observations?.length ?? 0) > 40, limitations: ['origin-only-identity', 'no-page-or-provider-excerpts', 'sampled-single-page', 'scan-record-retention'] }
  while (bytes(evidence) > 32768 && evidence.observations.length) { evidence.observations.pop(); evidence.limited = true }
  if (bytes(evidence) > 32768 || Object.values(checks).some(record => bytes(record) > 1024)) {
    throw new RangeError('Evidence exceeds its storage budget')
  }
  return evidence
}
export type ScanEvidence = ReturnType<typeof buildScanEvidence>

/** Unsupported or malformed envelopes fail closed; registered historical methods retain their identity. */
export function readScanEvidence(value: unknown): ScanEvidence | null {
  try {
    const data = object(value)
    if (bytes(data) > 32768 || data.schemaVersion !== EVIDENCE_SCHEMA_VERSION) return null
    const candidate = data as unknown as ScanEvidence
    if (!candidate.requested || !candidate.evaluated || !candidate.comparison || !Array.isArray(candidate.observations)) return null
    if (!supportedPillarMethods.includes(candidate.pillarMethod as typeof supportedPillarMethods[number])) return null
    const rebuilt = buildEvidenceForMethod({ requestedUrl: candidate.requested.origin ?? '', evaluatedUrl: candidate.evaluated.origin ?? '', industry: candidate.comparison.industry, region: candidate.comparison.region, sitemapSource: candidate.comparison.sitemapSource, checks: candidate.checks, observations: candidate.observations, collectedAt: candidate.collectedAt ?? undefined, limited: candidate.limited }, candidate.pillarMethod)
    // Descriptors carry redaction history which cannot be reconstructed from an origin.
    rebuilt.requested = normalizeDescriptor(candidate.requested)
    rebuilt.evaluated = normalizeDescriptor(candidate.evaluated)
    return JSON.stringify(canonical(rebuilt)) === JSON.stringify(canonical(candidate)) ? rebuilt : null
  } catch { return null }
}
export function compareScanEvidence(before: unknown, after: unknown) {
  const a = readScanEvidence(before), b = readScanEvidence(after)
  if (!a || !b) return { comparable: false, reason: 'unknown-evidence' }
  if (a.comparisonSignature !== b.comparisonSignature) return { comparable: false, reason: 'different-methods-or-scope' }
  if ([a,b].some(e => Object.values(e.checks).some(c => c.collection !== 'complete'))) return { comparable: false, reason: 'incomplete-collection' }
  // v1 deliberately withholds final path identity, even for root targets.
  return { comparable: false, reason: 'final-path-identity-withheld' }
}

/** Server-only validation; return a minimal serializable seam for pure diagnostic consumers. */
export function pillarInputsFromEvidence(value: unknown): PillarEvidenceInputs {
  const evidence = readScanEvidence(value)
  if (!evidence) return {}
  return Object.fromEntries(Object.entries(evidence.checks).map(([key, check]) => [key, {
    applicability: check.applicability, collection: check.collection, assessment: check.assessment,
  }]))
}
