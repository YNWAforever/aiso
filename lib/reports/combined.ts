import { db } from '@/lib/db'
import { readShareOfVoice } from '@/lib/pulse/share-of-voice'
import { loadOwnedReportClient, loadReportBranding } from './store'
import {
  buildCombinedPulseView,
  buildCombinedScanView,
  isoDate,
  type CombinedPulse,
  type CombinedReportData,
  type CombinedScan,
  type ReportLocale,
  type ScanSource,
} from './combined-view'

export type {
  CombinedCheckStatus,
  CombinedPulse,
  CombinedReportCheck,
  CombinedReportData,
  CombinedReportIssue,
  CombinedScan,
  ReportLocale,
  ScanSource,
} from './combined-view'

function scanSource(row: unknown, accountId: string): ScanSource | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  const createdAt = isoDate(value.created_at)
  if (typeof value.id !== 'string' || typeof value.domain !== 'string' || !createdAt) return null
  const score = typeof value.score === 'number' && Number.isFinite(value.score) ? value.score : null
  const grade = typeof value.grade === 'string' ? value.grade : null
  return {
    id: value.id,
    domain: value.domain,
    createdAt,
    score,
    grade,
    results: value.results,
    accountId,
  }
}

function activeQuestionCount(rows: unknown): number | null {
  const value = rows && typeof rows === 'object' ? (rows as Record<string, unknown>) : null
  const count = value && 'n' in value ? Number(value.n) : NaN
  return Number.isInteger(count) && count >= 0 ? count : null
}

/**
 * Read-only combined report data. Every read is account-scoped, and each half
 * fails independently so a missing scan never hides Pulse answers and a Pulse
 * read error never invents zeros.
 */
export async function loadCombinedReport(input: {
  accountId: string
  clientId: string
  locale: ReportLocale
}): Promise<CombinedReportData | null> {
  const client = await loadOwnedReportClient({ accountId: input.accountId, clientId: input.clientId })
  if (!client) return null

  const sql = db()
  const [scanResult, pulseResult, brandingResult, activeResult] = await Promise.allSettled([
    sql`
      select id, domain, created_at, score::float8 as score, grade, results
      from scans
      where account_id = ${input.accountId} and client_id = ${input.clientId}
      order by created_at desc
      limit 1
    `,
    readShareOfVoice(sql, input.accountId, input.clientId),
    loadReportBranding({ accountId: input.accountId }),
    sql`
      select count(*)::int as n
      from prompt_bank p
      join clients c on c.id = p.client_id
      where p.client_id = ${input.clientId}
        and c.account_id = ${input.accountId}
        and p.is_active = true
    `,
  ])

  let scan: CombinedScan = { state: 'unavailable' }
  if (scanResult.status === 'fulfilled') {
    const rows = scanResult.value as unknown[]
    scan = rows.length === 0 ? { state: 'none' } : (() => {
      const source = scanSource(rows[0], input.accountId)
      return source ? buildCombinedScanView(source, input.locale) : { state: 'unavailable' }
    })()
  }

  let pulse: CombinedPulse = { state: 'unavailable' }
  if (pulseResult.status === 'fulfilled') {
    pulse = pulseResult.value === null
      ? { state: 'unavailable' }
      : buildCombinedPulseView(pulseResult.value)
  }

  const branding = brandingResult.status === 'fulfilled' && brandingResult.value?.accountId === input.accountId
    ? { agencyName: brandingResult.value.agencyName }
    : null

  return {
    client: { name: client.name, domain: client.domain },
    branding,
    scan,
    pulse,
    activeQuestions: activeResult.status === 'fulfilled' ? activeQuestionCount(activeResult.value[0]) : null,
    generatedAt: new Date().toISOString(),
  }
}
