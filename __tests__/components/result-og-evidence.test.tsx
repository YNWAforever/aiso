import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildScanEvidence, CHECK_VERSIONS } from '@/lib/scan-evidence'

const sql = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: () => sql }))
// Inspect the real image JSX before the external renderer turns it into PNG.
vi.mock('next/og', () => ({ ImageResponse: class {
  constructor(public element: ReactNode) {}
} }))
import Image from '@/app/[lang]/result/[id]/opengraph-image'

afterEach(() => vi.clearAllMocks())

async function card(results: Record<string, unknown>) {
  sql.mockResolvedValue([{ id: 'scan-1', domain: 'example.com', score: 62, grade: 'C',
    industry: 'technology', region: 'HK', results }])
  const rendered = await Image({ params: Promise.resolve({ id: 'scan-1' }) })
  return renderToStaticMarkup((rendered as unknown as { element: ReactNode }).element)
}

describe('shared result card evidence', () => {
  it('does not advertise legacy verdicts as confirmed passes or failures', async () => {
    const html = await card({
      c1_robots: { status: 'pass', message: 'robots_ai_allowed', details: 'PRIVATE_DETAIL' },
      c2_llms_txt: { status: 'fail', message: 'llms_txt_missing' },
      c3_bot_access: { status: 'warn', message: 'bots_partially_blocked' },
    })
    expect(html).toContain('0 passing')
    expect(html).toContain('0 warnings')
    expect(html).toContain('0 failing')
    expect(html).toContain('3 need evidence')
    expect(html).toContain('62')
    expect(html).not.toContain('PRIVATE_DETAIL')
  })

  it('counts complete evidence and withholds partial or failed checks', async () => {
    const checks = Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, {
      collection: 'unknown' as const, assessment: 'not-verifiable' as const,
    }]))
    const evidence = buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com',
      industry: 'technology', region: 'HK', sitemapSource: 'fetched',
      checks: { ...checks,
        c1_robots: { collection: 'complete', assessment: 'pass' },
        c2_llms_txt: { collection: 'failed', assessment: 'fail' },
        c3_bot_access: { collection: 'partial', assessment: 'warn' },
      },
      observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }],
    })
    const html = await card({ evidence,
      c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'fail' }, c3_bot_access: { status: 'warn' },
    })
    expect(html).toContain('1 passing')
    expect(html).toContain('0 warnings')
    expect(html).toContain('0 failing')
    expect(html).toContain('19 need evidence')
  })

  it('continues to hide every score and count when the page was not collected', async () => {
    const evidence = buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com',
      industry: null, region: null, sitemapSource: 'unknown', checks: {},
      observations: [{ check: 'page', collection: 'failed', httpStatus: 503, target: { origin: 'https://example.com' } }],
    })
    const html = await card({ evidence, c1_robots: { status: 'pass' } })
    expect(html).toContain('Scan could not be completed')
    expect(html).not.toContain('/100')
    expect(html).not.toContain(' passing')
    expect(html).not.toContain(' failing')
  })
})
