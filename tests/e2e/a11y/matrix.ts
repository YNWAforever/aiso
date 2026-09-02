import { TEST_SCAN_ID } from '../../constants.js'
import type { A11yTheme } from './baseline'

export type SupportedLang = 'en' | 'zh-HK'

/**
 * Routes that are safe to scan under E2E_FIXTURE_MODE=1.
 *
 * Excluded on purpose:
 *  - every /[lang]/dashboard/** and /admin route: lib/auth.ts:7 returns null
 *    from getProfile() in fixture mode, so requireAuth always redirects to
 *    login. They are unreachable, not merely unscanned.
 *  - /[lang]/r/[slug]: needs a live database row and an HMAC signature.
 *  - /[lang]/auth/{complete,google,logout}: each mutates its own DOM on mount
 *    (session exchange, social redirect, sign-out), so a scan races the page.
 *  - /[lang]/admin/authority and /[lang]/pulse/[clientId]: featureUnavailable
 *    stubs that render a translated heading and a link. They are public and
 *    would scan cleanly, but 32 extra matrix cells for two-element pages buys
 *    no coverage. Add them if either ever becomes a real page.
 */
export const A11Y_ROUTES = [
  { id: 'home', path: (lang: SupportedLang) => `/${lang}` },
  { id: 'pricing', path: (lang: SupportedLang) => `/${lang}/pricing` },
  { id: 'login', path: (lang: SupportedLang) => `/${lang}/auth/login` },
  { id: 'onboarding', path: (lang: SupportedLang) => `/${lang}/onboarding` },
  { id: 'result', path: (lang: SupportedLang) => `/${lang}/result/${TEST_SCAN_ID}` },
] as const

export const A11Y_LOCALES = ['en', 'zh-HK'] as const satisfies readonly SupportedLang[]

export const A11Y_THEMES = ['light', 'dark'] as const satisfies readonly A11yTheme[]
