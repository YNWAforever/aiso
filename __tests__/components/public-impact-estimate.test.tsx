import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResultClient } from '@/components/result/ResultClient'
import { buildPublicResultSummary } from '@/lib/result-access'

const language = vi.hoisted(() => ({ value: 'en' }))
vi.mock('next-intl', () => ({ useLocale: () => language.value, useTranslations: () => (key: string) => key }))
vi.mock('@/components/result/ClaimScanOnReturn', () => ({ ClaimScanOnReturn: () => null }))
vi.mock('@/components/result/AccountUnlockCard', () => ({ AccountUnlockCard: () => null }))
vi.mock('@/components/result/ShareButton', () => ({ ShareButton: () => null }))
vi.mock('@/lib/auth-client', () => ({ authClient: {}, buildAuthCompleteUrl: vi.fn() }))

const summary = buildPublicResultSummary({ id: 'public-scan', domain: 'example.com', score: 20, grade: 'F', industry: 'general_b2c', region: 'HK', results: {
  c1_robots: { status: 'fail', message: 'robots_blocked' },
  c2_llms_txt: { status: 'fail', message: 'llms_missing' },
  c3_bot_access: { status: 'warn', message: 'bot_partial' },
  c4_structured_data: { status: 'pass', message: 'schema_present' },
  c5_extractability: { status: 'warn', message: 'extractability_partial' },
} })

describe('public result impact estimate', () => {
  it.each([
    ['en', 'Estimated impact:', 'not measured visibility or guaranteed gains'],
    ['zh-HK', '預估影響：', '並非實際可見度測量，亦不保證改善成效'],
  ])('qualifies the public teaser in %s without owned evidence', (locale, heading, limit) => {
    language.value = locale
    const html = renderToStaticMarkup(<ResultClient lang={locale} summary={summary} />)
    expect(html).toContain(heading)
    expect(html).toContain(limit)
    expect(html).not.toContain('owned-scan-evidence')
    expect(html).not.toContain('full-check-breakdown')
  })
})
