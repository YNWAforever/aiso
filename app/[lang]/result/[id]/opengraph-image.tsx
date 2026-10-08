import { ImageResponse } from 'next/og'
import { db } from '@/lib/db'
import { buildPublicResultSummary, type PublicResultSummary } from '@/lib/result-access'
import type { Scan } from '@/lib/types'

export const alt = 'Website readiness scan — Fimmick AISO'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const GRADE_COLORS: Record<string, string> = {
  'A+': '#10b981', 'A': '#22c55e', 'B': '#3b82f6',
  'C': '#eab308', 'D': '#f97316', 'F': '#ef4444',
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let domain = 'fimmick.com'
  let score: number | null = null
  let grade = 'F'
  let counts: PublicResultSummary['counts'] = { pass: 0, warn: 0, fail: 0, unknown: 0, notApplicable: 0, total: 0 }
  let collectionFailed = false

  try {
    const rows = await db()`select domain, score, grade, results, industry, region from scans where id = ${id} limit 1`
    const scan = rows[0] as { domain: string; score: string | number | null; grade: string | null; results: Scan['results']; industry: string | null; region: string | null } | undefined
    if (scan) {
      const summary = buildPublicResultSummary({ ...scan, id, score: Number(scan.score ?? 0), results: scan.results ?? {} as Scan['results'] })
      domain = scan.domain
      collectionFailed = summary.collectionFailed
      score = collectionFailed || scan.score===null ? null : Math.round(Number(scan.score))
      grade = scan.grade ?? 'F'
      counts = summary.counts
    }
  } catch { /* unknown scan — render generic branded card */ }

  const gradeColor = GRADE_COLORS[grade] ?? '#ef4444'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          padding: 64, fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: '#2563eb',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 26, fontWeight: 900,
            }}>⚡</div>
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 900, color: 'white' }}>
              Fimmick&nbsp;<span style={{ color: '#60a5fa' }}>AISO</span>
            </div>
          </div>

          {/* Domain + grade */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', fontSize: 56, fontWeight: 900, color: 'white' }}>{domain}</div>
            {score !== null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: gradeColor, color: 'white', fontSize: 48, fontWeight: 900,
                  borderRadius: 20, padding: '8px 32px',
                }}>{grade}</div>
                <div style={{ display: 'flex', fontSize: 36, color: '#cbd5e1', fontWeight: 700 }}>
                  Website readiness score
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', fontSize: 36, color: '#cbd5e1', fontWeight: 700 }}>
                {collectionFailed ? 'Scan could not be completed — please retry' : 'Website readiness — technical and content checks'}
              </div>
            )}
            {score !== null && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 26, fontWeight: 700 }}>
                <span style={{ color: '#34d399' }}>✓ {counts.pass} passing</span>
                <span style={{ color: '#fbbf24' }}>⚠ {counts.warn} warnings</span>
                <span style={{ color: '#f87171' }}>✕ {counts.fail} failing</span>
                {counts.unknown > 0 && <span style={{ color: '#94a3b8' }}>{counts.unknown} need evidence</span>}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', fontSize: 24, color: '#64748b', fontWeight: 600 }}>
            Review your website readiness. Scan free →
          </div>
        </div>

        {/* Score ring */}
        {score !== null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 320 }}>
            {/* satori (next/og) cannot parse conic-gradient — solid grade-colored ring instead */}
            <div style={{
              width: 280, height: 280, borderRadius: 140, display: 'flex',
              flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              border: `20px solid ${gradeColor}`, background: '#0f172a',
            }}>
              <div style={{ display: 'flex', fontSize: 88, fontWeight: 900, color: 'white', lineHeight: 1 }}>{score}</div>
              <div style={{ display: 'flex', fontSize: 28, color: '#94a3b8', fontWeight: 600 }}>/100</div>
            </div>
          </div>
        )}
      </div>
    ),
    { ...size },
  )
}
