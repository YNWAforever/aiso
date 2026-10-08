import { notFound }        from 'next/navigation'
import { cache }            from 'react'
import { db }               from '@/lib/db'
import { getE2EScanFixture } from '@/lib/e2e-fixtures'
import { ResultClient }     from '@/components/result/ResultClient'
import { getProfile }       from '@/lib/auth'
import { buildOwnedResultEvidence } from '@/lib/result-evidence'
import { buildPublicResultSummary, canViewFullResult, hasFailedScanPage } from '@/lib/result-access'
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
  const isZh = lang === 'zh-HK'
  const scan = await getScan(id)

  if (!scan) {
    return { title: isZh ? 'AI 可見度掃描 — Fimmick AISO' : 'AI Visibility Scan — Fimmick AISO' }
  }

  if (hasFailedScanPage(scan.results as Record<string,unknown>)) {
    const title=isZh ? `${scan.domain} — 未能完成掃描` : `${scan.domain} — scan could not be completed`
    return {title,openGraph:{title},twitter:{card:'summary',title}}
  }
  const score = Math.round(scan.score)
  const grade = scan.grade ?? 'F'
  const title = isZh
    ? `${scan.domain} 的網站就緒分數 ${score}/100（${grade}）`
    : `${scan.domain} scored ${score}/100 (${grade}) on website readiness`
  const description = isZh
    ? `查看 ${scan.domain} 的網站技術及內容就緒檢查。此分數並非 AI 推薦率或曝光量。`
    : `Review technical and content readiness for ${scan.domain}. This score does not measure AI recommendations or exposure.`
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
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

  return (
    <ResultClient
      lang={lang}
      summary={summary}
      fullScan={unlocked ? scan : undefined}
      ownedEvidence={unlocked ? buildOwnedResultEvidence((scan.results as Record<string, unknown>).evidence, scan.results as Record<string, unknown>) : undefined}
    />
  )
}
