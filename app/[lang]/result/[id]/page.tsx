import { notFound }        from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { cache }            from 'react'
import { db }               from '@/lib/db'
import { getE2EScanFixture } from '@/lib/e2e-fixtures'
import { ResultClient }     from '@/components/result/ResultClient'
import { getProfile }       from '@/lib/auth'
import { buildOwnedResultEvidence } from '@/lib/result-evidence'
import { buildPublicResultSummary, canViewFullResult, hasFailedScanPage } from '@/lib/result-access'
import { compareScanEvidence } from '@/lib/scan-evidence'
import type { Scan }        from '@/lib/types'
import type { Metadata }    from 'next'

// Deduped across generateMetadata + page render for the same request.
// Returns null for unknown ids AND malformed ids (invalid uuid input).
const getScan = cache(async (id: string): Promise<Scan | null> => {
  const fixture = getE2EScanFixture(id)
  if (fixture) return fixture

  try {
    const rows = await db()`select * from scans where id = ${id} limit 1`
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return {
      ...row,
      // numeric comes back as string; timestamptz as Date — normalise to the Scan type
      score: row.score === null ? null : Number(row.score),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    } as Scan
  } catch {
    return null
  }
})

const EXPECTED_PROFILE_FAILURE_PATTERNS = [
  /NEON_AUTH_BASE_URL/i,
  /Invalid URL/i,
  /endsWith/i,
  /fetch failed/i,
  /network/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /timeout/i,
]

function isExpectedProfileLookupFailure(error: unknown) {
  if (!(error instanceof Error)) return false
  const cause = 'cause' in error ? String(error.cause) : ''
  const detail = [error.name, error.message, cause].join(': ')
  return EXPECTED_PROFILE_FAILURE_PATTERNS.some(pattern => pattern.test(detail))
}

async function getResultViewerProfile() {
  try {
    return await getProfile()
  } catch (error) {
    if (!isExpectedProfileLookupFailure(error)) {
      console.error('[result] Unexpected profile lookup failure', error)
    }
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}): Promise<Metadata> {
  const { lang, id } = await params
  const t = await getTranslations({ locale: lang, namespace: 'resultPage.meta' })
  const scan = await getScan(id)

  if (!scan) {
    return { title: t('default_title') }
  }

  if (hasFailedScanPage(scan.results as Record<string,unknown>)) {
    const title = t('failed_title', { domain: scan.domain })
    return {title,openGraph:{title},twitter:{card:'summary',title}}
  }
  const display = buildPublicResultSummary(scan)
  if (display.score === null || display.grade === null) {
    const title = t('unknown_title', { domain: scan.domain })
    return { title, openGraph: { title }, twitter: { card: 'summary', title } }
  }
  const score = Math.round(display.score)
  const grade = display.grade
  const title = t('title', { domain: scan.domain, score, grade })
  const description = t('description', { domain: scan.domain })
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/**
 * The owner's most recent earlier scan of the same domain, for the score
 * delta and the one celebration. Filtered by the viewer's own account, never
 * the scan's: only an owner reaches this. Only a comparable scan counts (same
 * scanner method, checks, industry, region and scope, per its evidence
 * signature): otherwise a method or scope change would read as an improvement.
 * A failed lookup just skips the celebration.
 */
async function getPreviousOwnedScan(scan: Scan, accountId: string): Promise<{ score: number; grade: string } | null> {
  if (!scan.created_at) return null
  try {
    const rows = await db()`
      select score, grade, results->'evidence' as evidence from scans
      where account_id = ${accountId} and domain = ${scan.domain} and id <> ${scan.id}
        and created_at < ${scan.created_at} and score is not null and grade is not null
      order by created_at desc limit 1`
    const row = rows[0] as { score: unknown; grade: unknown; evidence: unknown } | undefined
    const score = row ? Number(row.score) : NaN
    if (!row || !Number.isFinite(score) || typeof row.grade !== 'string') return null
    const current = (scan.results as Record<string, unknown>).evidence
    return compareScanEvidence(row.evidence, current).comparable ? { score, grade: row.grade } : null
  } catch {
    return null
  }
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}) {
  const { lang, id } = await params

  const scan = await getScan(id)

  if (!scan) notFound()

  const profile = await getResultViewerProfile()
  const unlocked = canViewFullResult(scan.account_id, profile?.account_id)
  const summary = buildPublicResultSummary(scan)
  const previous = unlocked && profile?.account_id ? await getPreviousOwnedScan(scan, profile.account_id) : null

  return (
    <ResultClient
      lang={lang}
      summary={summary}
      fullScan={unlocked ? scan : undefined}
      ownedEvidence={unlocked ? buildOwnedResultEvidence((scan.results as Record<string, unknown>).evidence, scan.results as Record<string, unknown>) : undefined}
      previous={previous}
    />
  )
}
