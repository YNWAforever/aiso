import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const componentPath = fileURLToPath(new URL('../../components/auth/GoogleAuthStart.tsx', import.meta.url))
const pagePath = fileURLToPath(new URL('../../app/[lang]/auth/google/page.tsx', import.meta.url))

describe('top-level Google auth bridge', () => {
  it('provides a top-level route that starts Google auth and preserves next', () => {
    expect(existsSync(componentPath)).toBe(true)
    expect(existsSync(pagePath)).toBe(true)
    if (!existsSync(componentPath) || !existsSync(pagePath)) return

    const component = readFileSync(componentPath, 'utf8')
    const page = readFileSync(pagePath, 'utf8')

    expect(component).toContain("authClient.signIn.social({ provider: 'google', callbackURL })")
    expect(component).toContain('startGoogleAuthRedirect')
    expect(page).toContain('<GoogleAuthStart lang={lang} next={next} />')
  })
})
