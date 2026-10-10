import { describe, expect, it, vi } from 'vitest'
import { getPlatformStatusLabel } from '@/components/result/ResultClient'

vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  buildAuthCompleteUrl: vi.fn(),
}))

describe('public platform status labels', () => {
  it('renders readable English labels without changing the underlying status', () => {
    expect(getPlatformStatusLabel('visible', 'en')).toBe('Legacy technical estimate')
    expect(getPlatformStatusLabel('partial', 'en')).toBe('Legacy technical estimate')
    expect(getPlatformStatusLabel('blocked', 'en')).toBe('Legacy technical estimate')
    expect(getPlatformStatusLabel('not_measured', 'en')).toBe('Not measured')
  })

  it('renders localized zh-HK labels', () => {
    expect(getPlatformStatusLabel('visible', 'zh-HK')).toBe('歷史技術估算')
    expect(getPlatformStatusLabel('partial', 'zh-HK')).toBe('歷史技術估算')
    expect(getPlatformStatusLabel('blocked', 'zh-HK')).toBe('歷史技術估算')
    expect(getPlatformStatusLabel('not_measured', 'zh-HK')).toBe('未量度')
  })
})
