import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanResults } from '@/lib/types'

const locale = vi.hoisted(() => ({ value: 'en' }))

vi.mock('next-intl', () => ({
  useLocale: () => locale.value,
}))

import { TopIssueCard } from '@/components/result/TopIssueCard'

function renderIssue(status: 'warn' | 'fail', failCount = 2) {
  const results = {
    c2_llms_txt: { status, message: 'public_summary' },
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
})
