import type { ChangeKind, ComparisonState, ReportScanInput as ReportScan } from './types'

export type ReportScanInput = ReportScan

export const REPORTABLE_CHECKS = [
  'c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability',
  'c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings',
  'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness',
] as const

type ReportableCheck = (typeof REPORTABLE_CHECKS)[number]
type CheckStatus = 'pass' | 'warn' | 'fail'
type EvidenceValue = { state: 'absent' | 'gap' | 'invalid' } | { state: 'value'; status: CheckStatus }

const CHECK_LABELS: Record<ReportableCheck, string> = {
  c1_robots: 'Robots access', c2_llms_txt: 'LLMs.txt', c3_bot_access: 'Bot access',
  c4_structured_data: 'Structured data', c5_extractability: 'Extractability',
  c6_llms_full_txt: 'Extended LLMs.txt', c7_mcp_card: 'MCP card', c8_sitemap: 'Sitemap',
  c9_meta_desc: 'Meta description', c10_headings: 'Headings', c11_faq: 'FAQ',
  c12_canonical: 'Canonical URL', c13_render: 'Rendering', c14_internal_links: 'Internal links',
  c15_entity: 'Entity clarity', c16_freshness: 'Content freshness',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function evidenceValue(value: unknown, present: boolean): EvidenceValue {
  if (!present) return { state: 'absent' }
  if (value === null || value === undefined) return { state: 'gap' }
  if (!isRecord(value) || !['pass', 'warn', 'fail'].includes(String(value.status))) return { state: 'invalid' }
  return { state: 'value', status: value.status as CheckStatus }
}

function scoreStatus(status: CheckStatus): number {
  return status === 'pass' ? 2 : status === 'warn' ? 1 : 0
}

export function normalizeReportDomain(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname || hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null
    return hostname
  } catch {
    return null
  }
}

function usableScan(value: unknown): value is ReportScanInput {
  if (!isRecord(value)) return false
  return typeof value.accountId === 'string' && value.accountId.length > 0
    && typeof value.domain === 'string' && normalizeReportDomain(value.domain) !== null
    && typeof value.createdAt === 'string' && Number.isFinite(new Date(value.createdAt).getTime())
    && typeof value.score === 'number' && Number.isFinite(value.score)
    && typeof value.grade === 'string'
}

export function selectPreviousReportScan(
  current: ReportScanInput,
  candidates: ReadonlyArray<unknown>,
): ReportScanInput | null {
  if (!usableScan(current)) return null
  const currentDomain = normalizeReportDomain(current.domain)
  const currentTime = new Date(current.createdAt).getTime()
  return candidates
    .filter(usableScan)
    .filter(candidate => candidate.accountId === current.accountId && normalizeReportDomain(candidate.domain) === currentDomain)
    .filter(candidate => new Date(candidate.createdAt).getTime() < currentTime)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null
}

export interface ReportEvidenceComparison {
  readonly comparisonState: ComparisonState
  readonly changes: ReadonlyArray<{ key: string; label: string; kind: ChangeKind }>
}

export function compareReportEvidence(current: unknown, previous: unknown): ReportEvidenceComparison {
  if (!isRecord(current) || !isRecord(previous)) return { comparisonState: 'not_comparable', changes: [] }
  const changes: Array<{ key: string; label: string; kind: ChangeKind }> = []
  for (const key of REPORTABLE_CHECKS) {
    const now = evidenceValue(current[key], Object.hasOwn(current, key))
    const before = evidenceValue(previous[key], Object.hasOwn(previous, key))
    if (now.state === 'invalid' || before.state === 'invalid') return { comparisonState: 'not_comparable', changes: [] }
    if (now.state === 'absent' && before.state === 'absent') continue
    let kind: ChangeKind
    if (now.state === 'gap' || before.state === 'gap') kind = 'data_gap'
    else if (now.state === 'absent') kind = 'lost_coverage'
    else if (before.state === 'absent') kind = 'added_coverage'
    else if (now.state === 'value' && before.state === 'value') {
      if (scoreStatus(now.status) > scoreStatus(before.status)) kind = 'improved'
      else if (scoreStatus(now.status) < scoreStatus(before.status)) kind = 'regressed'
      else kind = 'unchanged'
    } else kind = 'data_gap'
    changes.push({ key, label: CHECK_LABELS[key], kind })
  }
  return { comparisonState: 'comparable', changes }
}
