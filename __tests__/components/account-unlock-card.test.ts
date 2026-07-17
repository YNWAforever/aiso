import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  buildAuthCompleteUrl: vi.fn(),
}))

import { runAccountUnlockRequest } from '@/components/result/AccountUnlockCard'

describe('account unlock auth requests', () => {
  it('reports a localized generic failure and clears loading when the SDK throws', async () => {
    const onFailure = vi.fn()
    const onSuccess = vi.fn()
    const onFinally = vi.fn()

    await runAccountUnlockRequest({
      request: vi.fn().mockRejectedValue(new Error('network down')),
      onFailure,
      onSuccess,
      onFinally,
    })

    expect(onFailure).toHaveBeenCalledWith(undefined)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFinally).toHaveBeenCalledOnce()
  })

  it('passes returned SDK errors to the component and still clears loading', async () => {
    const error = { code: 'TOO_MANY_ATTEMPTS', message: 'rate limited' }
    const onFailure = vi.fn()
    const onFinally = vi.fn()

    await runAccountUnlockRequest({
      request: vi.fn().mockResolvedValue({ error }),
      onFailure,
      onSuccess: vi.fn(),
      onFinally,
    })

    expect(onFailure).toHaveBeenCalledWith(error)
    expect(onFinally).toHaveBeenCalledOnce()
  })
})
