import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildScanEvidence, CHECK_VERSIONS } from '@/lib/scan-evidence'
import { buildPublicResultSummary } from '@/lib/result-access'
import { buildOwnerPriorities } from '@/lib/view-models/owner-priorities'
import type { ScanResults } from '@/lib/types'

const locale = vi.hoisted(() => ({ value: 'en' }))

vi.mock('next-intl', () => ({
  useLocale: () => locale.value,
}))

import { TopIssueCard } from '@/components/result/TopIssueCard'

function renderIssue(status: 'warn' | 'fail', failCount = 2) {
  const results = {
    c2_llms_txt: { status, assessment: status, collection: 'complete', applicability: 'applicable', message: 'public_summary' },
  } as unknown as ScanResults & Record<string, unknown>

  return renderToStaticMarkup(<TopIssueCard results={results} failCount={failCount} />)
}

describe('public top issue presentation', () => {
  beforeEach(() => {
    locale.value = 'en'
  })

  it('renders an accessible amber Warning badge and account-oriented copy', () => {
    const html = renderIssue('warn')

    expect(html).toContain('data-severity="warn"')
    expect(html).toContain('aria-label="Severity: Warning"')
    expect(html).toContain('>Warning</span>')
    expect(html).toContain('bg-amber-50')
    expect(html).toContain('create a free account to see the full breakdown')
    expect(html).not.toContain('enter your email')
  })

  it('renders an accessible red Failed badge distinct from warnings', () => {
    const html = renderIssue('fail')

    expect(html).toContain('data-severity="fail"')
    expect(html).toContain('aria-label="Severity: Failed"')
    expect(html).toContain('>Failed</span>')
    expect(html).toContain('bg-red-50')
    expect(html).not.toContain('bg-amber-50')
  })

  it('renders the zh-HK warning label and account-oriented remaining-issues copy', () => {
    locale.value = 'zh-HK'
    const html = renderIssue('warn')

    expect(html).toContain('aria-label="嚴重程度：警告"')
    expect(html).toContain('>警告</span>')
    expect(html).toContain('免費建立帳戶即可查看完整分析')
    expect(html).not.toContain('輸入電郵')
  })
  it.each(['en', 'zh-HK'])('offers retry instead of a confirmed fix for unknown collection %s', lang => {
    locale.value = lang
    const html = renderToStaticMarkup(<TopIssueCard results={{ c1_robots: { status: 'fail' } } as never} failCount={0} />)
    expect(html).toContain('data-priority-state="insufficient-evidence"')
    expect(html).not.toContain('data-severity="fail"')
    expect(html).toContain(`href="/${lang}"`)
  })
})

afterAll(() => {
  const dir = process.env.AISO_PRIORITY_HTML_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const base = { assessment: 'pass', collection: 'complete' }
  const scenarios = {
    mixed: { c6_llms_full_txt: { ...base, assessment: 'warn' }, c8_sitemap: { ...base, assessment: 'fail' } },
    warning: { c6_llms_full_txt: { ...base, assessment: 'warn' } },
    incomplete: { c1_robots: { assessment: 'fail', collection: 'failed' }, c6_llms_full_txt: { ...base, assessment: 'warn' } },
    unknown: null, pass: {}, 'not-applicable': null,
  }
  for (const lang of ['en', 'zh-HK']) for (const [name, overrides] of Object.entries(scenarios)) {
    locale.value = lang
    const fallback = name === 'unknown' ? { assessment: 'fail', collection: 'unknown' } : name === 'not-applicable' ? { ...base, assessment: 'not-applicable' } : base
    const checks = Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, (overrides as Record<string, typeof base> | null)?.[key] ?? fallback]))
    const evidence = buildScanEvidence({ requestedUrl: 'https://synthetic.test', evaluatedUrl: 'https://synthetic.test', industry: 'technology', region: 'HK', sitemapSource: 'fetched', checks })
    const scan = { id: 'synthetic', domain: 'synthetic.test', score: 50, grade: 'D', results: { evidence } }
    const summary = buildPublicResultSummary(scan as never), owner = buildOwnerPriorities(evidence)
    const project = (key: string | null, status: string | null) => key ? { [key]: { assessment: status, collection: 'complete', applicability: 'applicable' } } : {}
    const html = renderToStaticMarkup(<main><h1>{lang === 'en' ? 'Scan priorities' : '掃描改善優先序'}</h1>
      <section aria-label="Public"><h2>{lang === 'en' ? 'Public result' : '公開結果'}</h2><TopIssueCard results={project(summary.topIssueKey, summary.topIssueStatus) as never} priorityState={summary.priorityState} failCount={summary.counts.fail + summary.counts.warn} /></section>
      <section aria-label="Owner"><h2>{lang === 'en' ? 'Owner result' : '登入結果'}</h2><TopIssueCard results={project(owner.primaryAction?.checkKey ?? null, owner.primaryAction?.assessment ?? null) as never} priorityState={summary.priorityState} failCount={owner.observedFindings} /></section>
    </main>)
    writeFileSync(join(dir, `${lang}-${name}.html`), html)
  }
})
