import { describe, expect, it, vi } from 'vitest'
import DashboardError from '@/app/[lang]/dashboard/error'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

describe('dashboard error boundary', () => {
  it.each(['en', 'zh-HK'] as const)('shows an illustration, one line and one retry button in %s', lang => {
    const copy = (lang === 'en' ? en : zh).dashboard.states
    const html = renderWithIntl(<DashboardError error={new Error('boom')} retry={vi.fn()} />, lang)
    expect(html).toContain(copy.errorTitle)
    expect(html).toContain(copy.errorBody)
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain(copy.retry)
    expect(html).not.toContain('boom')
  })
})
