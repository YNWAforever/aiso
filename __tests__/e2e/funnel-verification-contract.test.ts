import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('funnel verification contracts', () => {
  it('proves the Neon magic-link request and exact localized success state', () => {
    const source = read('tests/e2e/auth.spec.ts')
    const loginSource = read('components/auth/LoginForm.tsx')

    expect(source).toContain("page.waitForRequest")
    expect(source).toContain("new URL(request.url()).pathname.endsWith('/sign-in/magic-link')")
    expect(source).toContain("getByText(copy.checkEmail, { exact: true })")
    expect(source).not.toContain("text=/sent|check|email|magic|success/i")
    expect(source).toContain('provider error recovery')
    expect(loginSource).toContain('error.code === \'TOO_MANY_ATTEMPTS\'')
    expect(loginSource).toContain('c.magicLinkFailed')
    expect(loginSource).not.toContain('error.message')
  })

  it('runs the pricing containment regression at exactly 375px', () => {
    const source = read('tests/e2e/scan-flow.spec.ts')

    expect(source).toContain("test.use({ viewport: { width: 375, height: 812 } })")
    expect(source).toContain('expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client)')
    expect(source).toContain('expect(widths.scroll).toBeGreaterThan(widths.client)')
    expect(source).not.toContain('if (viewportWidth <= 375)')
  })

  it('always reseeds the fixed scan as anonymous and keeps teardown deterministic', () => {
    const setup = read('tests/globalSetup.ts')
    const teardown = read('tests/globalTeardown.ts')

    expect(setup).toMatch(/account_id:\s+null/)
    expect(setup).toContain('resolution=merge-duplicates,return=representation')
    expect(teardown).toContain('id=eq.${TEST_SCAN_ID}')
    expect(teardown).toContain("method: 'DELETE'")
  })

  it('keeps the live scan smoke release-gated instead of silently skipping it', () => {
    const source = read('tests/e2e/live-scan-smoke.spec.ts')

    expect(source).toContain("const baseUrl = process.env.BASE_URL")
    expect(source).toContain("throw new Error('BASE_URL is required for the release scan gate')")
    expect(source).toContain("const target = process.env.LIVE_SCAN_TARGET")
    expect(source).toContain("throw new Error('LIVE_SCAN_TARGET is required for the release scan gate')")
    expect(source).not.toContain('test.skip')
    expect(source).toContain("page.goto('/en')")
    expect(source).toContain("/\\/en\\/result\\/[A-Za-z0-9-]+/")
  })
})
