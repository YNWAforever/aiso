import { describe, expect, it, vi } from 'vitest'
import { getPlatformStatusLabel } from '@/components/result/ResultClient'

vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  buildAuthCompleteUrl: vi.fn(),
}))

describe('public platform status labels', () => {
  it('renders readable English labels without changing the underlying status', () => {
    expect(getPlatformStatusLabel('visible', 'en')).toBe('Visible')
    expect(getPlatformStatusLabel('partial', 'en')).toBe('Partial')
    expect(getPlatformStatusLabel('blocked', 'en')).toBe('Hidden')
  })

  it('renders localized zh-HK labels', () => {
    expect(getPlatformStatusLabel('visible', 'zh-HK')).toBe('可見')
    expect(getPlatformStatusLabel('partial', 'zh-HK')).toBe('部分可見')
    expect(getPlatformStatusLabel('blocked', 'zh-HK')).toBe('隱藏')
  })
})
