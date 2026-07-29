import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// LockedFeature's checkout button runs inside an inline async onClick handler
// with real network + browser-navigation side effects (window.location.href).
// This test suite has no DOM/jsdom environment configured (the repo's other
// component tests all use renderToStaticMarkup, which can't exercise click
// handlers), so — matching the source-pinning pattern already used in
// __tests__/lib/commercial-surface-contract.test.ts for this same class of
// client-only interaction code — we pin the fixed source directly rather than
// simulate a click.
function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('LockedFeature checkout failure handling', () => {
  it('checks res.ok before reading the checkout url, instead of the old silent no-op', () => {
    const src = source('components/dashboard/LockedFeature.tsx')
    const handlerStart = src.indexOf('onClick={async () => {')
    const handlerEnd = src.indexOf('className="inline-flex items-center px-4 py-2', handlerStart)
    const handler = src.slice(handlerStart, handlerEnd)

    const resIndex = handler.indexOf('const res = await fetch(')
    const okCheckIndex = handler.indexOf('if (!res.ok)')
    const dataIndex = handler.indexOf('const data = await res.json()')

    expect(handlerStart).toBeGreaterThanOrEqual(0)
    expect(resIndex).toBeGreaterThanOrEqual(0)
    expect(okCheckIndex).toBeGreaterThan(resIndex)
    expect(dataIndex).toBeGreaterThan(okCheckIndex)
  })

  it('surfaces a localized failure instead of doing nothing on a non-ok or url-less response', () => {
    const src = source('components/dashboard/LockedFeature.tsx')

    expect(src).toContain('setCheckoutError(true)')
    expect(src).toContain("t('locked_checkout_failed')")
    expect(src).toContain('role="alert"')
    // The catch branch must not swallow a network failure silently either.
    expect(src).toMatch(/catch\s*\{\s*setCheckoutError\(true\)/)
  })

  it('still performs a real navigation via window.location.href on success', () => {
    const src = source('components/dashboard/LockedFeature.tsx')
    expect(src).toContain('window.location.href = data.url')
  })

  it('defines the checkout-failed message in both locales', () => {
    const en = JSON.parse(source('messages/en.json')) as { dashboard: Record<string, string> }
    const zh = JSON.parse(source('messages/zh-HK.json')) as { dashboard: Record<string, string> }

    expect(en.dashboard.locked_checkout_failed).toBeTruthy()
    expect(zh.dashboard.locked_checkout_failed).toBeTruthy()
    expect(en.dashboard.locked_checkout_failed).not.toBe(zh.dashboard.locked_checkout_failed)
  })
})
