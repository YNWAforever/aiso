import { describe, expect, it, vi } from 'vitest'
import { createTranslator } from 'next-intl'
import { getPlatformStatusLabel } from '@/components/result/ResultClient'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  buildAuthCompleteUrl: vi.fn(),
}))

const translator = (locale: 'en' | 'zh-HK') =>
  createTranslator({ locale, messages: locale === 'zh-HK' ? zh : en, namespace: 'resultPage' })

describe('public platform status labels', () => {
  it('renders readable English labels without changing the underlying status', () => {
    const t = translator('en')
    expect(getPlatformStatusLabel('visible', t)).toBe('Legacy technical estimate')
    expect(getPlatformStatusLabel('partial', t)).toBe('Legacy technical estimate')
    expect(getPlatformStatusLabel('blocked', t)).toBe('Legacy technical estimate')
    expect(getPlatformStatusLabel('not_measured', t)).toBe('Not measured')
  })

  it('renders localized zh-HK labels', () => {
    const t = translator('zh-HK')
    expect(getPlatformStatusLabel('visible', t)).toBe('歷史技術估算')
    expect(getPlatformStatusLabel('partial', t)).toBe('歷史技術估算')
    expect(getPlatformStatusLabel('blocked', t)).toBe('歷史技術估算')
    expect(getPlatformStatusLabel('not_measured', t)).toBe('未量度')
  })
})
