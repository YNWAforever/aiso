import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  buildAuthCompleteUrl: vi.fn(),
}))

import * as accountUnlock from '@/components/result/AccountUnlockCard'

const { runAccountUnlockRequest } = accountUnlock

describe('account unlock auth requests', () => {
  it('exposes a dedicated Google launcher for embedded browser recovery', () => {
    expect(accountUnlock.launchGoogleAccountUnlock).toBeTypeOf('function')
  })
  it('opens a top-level bridge synchronously in an embedded browser instead of invoking the SDK popup flow', async () => {
    const popup = { opener: {}, closed: false, focus: vi.fn() }
    const openWindow = vi.fn(() => popup)
    const request = vi.fn()

    const result = await accountUnlock.launchGoogleAccountUnlock({
      embedded: true,
      bridgeURL: '/en/auth/google?next=%2Fen%2Fonboarding%3Fscan%3Dscan-123',
      openWindow,
      request,
    })

    expect(openWindow).toHaveBeenCalledWith(
      '/en/auth/google?next=%2Fen%2Fonboarding%3Fscan%3Dscan-123',
      'fimmick-google-auth',
    )
    expect(popup.opener).toBeNull()
    expect(request).not.toHaveBeenCalled()
    expect(result.error).toBeNull()
    expect(result.popup).toBe(popup)
  })


  it('reuses and focuses an active Google window so rapid activation starts only one flow', async () => {
    const popup = { opener: null, closed: false, focus: vi.fn() }
    const openWindow = vi.fn()

    const result = await accountUnlock.launchGoogleAccountUnlock({
      embedded: true,
      bridgeURL: '/en/auth/google?next=%2Fen%2Fdashboard',
      activePopup: popup,
      openWindow,
      request: vi.fn(),
    })

    expect(openWindow).not.toHaveBeenCalled()
    expect(popup.focus).toHaveBeenCalledOnce()
    expect(result.popup).toBe(popup)
  })

  it('opens a fresh Google window after the previous window closes', async () => {
    const closedPopup = { opener: null, closed: true, focus: vi.fn() }
    const freshPopup = { opener: {}, closed: false, focus: vi.fn() }
    const openWindow = vi.fn(() => freshPopup)

    const result = await accountUnlock.launchGoogleAccountUnlock({
      embedded: true,
      bridgeURL: '/en/auth/google?next=%2Fen%2Fdashboard',
      activePopup: closedPopup,
      openWindow,
      request: vi.fn(),
    })

    expect(openWindow).toHaveBeenCalledOnce()
    expect(result.popup).toBe(freshPopup)
  })

  it('reports a blocked embedded-browser window without invoking the SDK popup flow', async () => {
    const request = vi.fn()

    const result = await accountUnlock.launchGoogleAccountUnlock({
      embedded: true,
      bridgeURL: '/en/auth/google?next=%2Fen%2Fdashboard',
      openWindow: vi.fn(() => null),
      request,
    })

    expect(request).not.toHaveBeenCalled()
    expect(result.error?.code).toBe('POPUP_BLOCKED')
  })


  it('closes the Google window and fails when opener isolation is unavailable', async () => {
    const close = vi.fn()
    const popup = {
      closed: false,
      focus: vi.fn(),
      close,
      set opener(_value: unknown) {
        throw new Error('opener is restricted')
      },
    }

    const result = await accountUnlock.launchGoogleAccountUnlock({
      embedded: true,
      bridgeURL: '/en/auth/google?next=%2Fen%2Fdashboard',
      openWindow: vi.fn(() => popup),
      request: vi.fn(),
    })

    expect(close).toHaveBeenCalledOnce()
    expect(result.error?.code).toBe('OPENER_ISOLATION_FAILED')
    expect(result.popup).toBeUndefined()
  })

  it('keeps the SDK redirect flow for normal top-level browsers', async () => {
    const requestResult = { error: null }
    const request = vi.fn().mockResolvedValue(requestResult)

    const result = await accountUnlock.launchGoogleAccountUnlock({
      embedded: false,
      bridgeURL: '/en/auth/google?next=%2Fen%2Fdashboard',
      openWindow: vi.fn(),
      request,
    })

    expect(request).toHaveBeenCalledOnce()
    expect(result).toBe(requestResult)
  })

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
