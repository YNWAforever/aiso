import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))

/**
 * The first-run wizard, in both languages and at a phone's width.
 *
 * This surface had no render coverage while nothing linked to it. Now the
 * portfolio's empty state does, and its copy lives in two in-file constants
 * (`COPY_EN` / `COPY_ZH_HK`) rather than in `messages/*.json` — so
 * `message-catalogue-parity.test.ts` does not see it, and never did. A missing
 * Chinese string here would fall back to English silently, on the very first
 * screen a new owner sees.
 */

const LANGS = ['en', 'zh-HK'] as const

const render = (lang: (typeof LANGS)[number]) =>
  renderToStaticMarkup(
    <OnboardingWizard
      lang={lang}
      scanId="scan-abc"
      initialBrand=""
      initialDomain=""
      initialIndustry=""
      initialRegion=""
    />,
  )

describe('the onboarding wizard renders in both languages', () => {
  it.each(LANGS)('renders step one (%s)', lang => {
    const markup = render(lang)

    expect(markup).toContain('onboarding-brand')
    expect(markup.length).toBeGreaterThan(200)
  })

  it('says different things in each language', () => {
    // Byte-identical renders would mean one copy constant is answering for both,
    // which is precisely what a silent English fallback looks like.
    expect(render('en')).not.toBe(render('zh-HK'))
  })

  it('does not leak the English step-one heading into the Chinese render', () => {
    // Matched without the apostrophe: React escapes it to `&#x27;`, so the
    // literal string never appears in the markup in either language.
    expect(render('en')).toContain('your brand name?')
    expect(render('zh-HK')).not.toContain('your brand name?')
  })

  it.each(LANGS)('gives every control a touch-sized target (%s)', lang => {
    const markup = render(lang)
    const controls = markup.match(/<(button|input|select|a)\b[^>]*>/g) ?? []
    const tooSmall = controls.filter(control => {
      if (control.includes('type="hidden"')) return false
      if (control.includes('sr-only')) return false // the skip link, visible only on focus
      return !/min-h-1[124]|h-1[124]|py-[3-9]|min-h-\[4[0-9]px\]/.test(control)
    })

    expect(tooSmall, `controls without a touch-sized height:\n${tooSmall.join('\n')}`).toEqual([])
  })
})
