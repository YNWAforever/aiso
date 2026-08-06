import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const resolvePath = (p: string) => join(process.cwd(), p)

function read(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

/**
 * Source with comments removed.
 *
 * These assertions are about what the page *does*, and a doc comment explaining
 * why it deliberately avoids QuestionBankSection would otherwise read as
 * mounting it. Prose must not be able to pass or fail a behavioural assertion.
 */
function code(path: string) {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const PAGE = 'app/[lang]/dashboard/[clientId]/prompts/page.tsx'

describe('question bank page', () => {
  it('renders the editor instead of redirecting to the unavailable placeholder', () => {
    // It used to redirect to /{lang}/pulse/{clientId}, which resolves to a
    // 21-line "unavailable" page — so the fully-built editor was unreachable
    // and the question bank was frozen at whatever onboarding generated.
    const page = code(PAGE)

    expect(page).not.toContain('redirect(')
    // The old redirect target specifically — not any /pulse/ path, since the
    // editor itself lives under components/pulse/.
    expect(page).not.toContain('/pulse/${clientId}')
    expect(page).toContain('QuestionBankSection')
  })

  it('mounts the suggest panel now that its route is restored', () => {
    // The page rendered PromptBankEditor directly while
    // /api/pulse/suggest-questions returned 503 and while the panel's accept
    // handler wrote to a second copy of the list. Both are fixed, so the
    // wrapper — and the only entry point to suggestions — is mounted.
    const page = code(PAGE)
    const section = readFileSync(
      resolvePath('components/pulse/QuestionBankSection.tsx'), 'utf8',
    )

    expect(page).toContain('QuestionBankSection')
    expect(section).toContain('SuggestQuestionsPanel')
  })

  it('gates on auth, then ownership, then entitlement', () => {
    const page = code(PAGE)

    expect(page).toContain('requireAuth(locale)')
    expect(page).toContain('account_id = ${profile.account_id}')
    expect(page).toContain('notFound()')
    expect(page).toContain('entitlement.features.edit_prompts')

    // Ownership must resolve before the entitlement branch, so an owner on a
    // lower plan sees their own brand's locked state rather than a 404.
    expect(page.indexOf('notFound()')).toBeLessThan(page.indexOf('features.edit_prompts'))
  })

  it('scopes the prompt query by client_id', () => {
    const page = code(PAGE)
    const query = page.slice(page.indexOf('from prompt_bank'))

    expect(query).toContain('where client_id = ${clientId}')
  })

  it('orders identically to the API so the two never disagree', () => {
    expect(code(PAGE)).toContain('order by category, created_at, id')
  })

  it('normalises lang before handing it to requireAuth', () => {
    // requireAuth builds a redirect URL from it; the reports page normalises
    // and this follows that, rather than the layout which passes it raw.
    expect(code(PAGE)).toContain("const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'")
  })

  it('reuses the locked-state copy that already existed in both locales', () => {
    const page = code(PAGE)
    expect(page).toContain("t('qb_locked_body')")
    expect(page).toContain("t('qb_see_plans')")

    for (const locale of ['en', 'zh-HK'] as const) {
      const pulse = JSON.parse(read(`messages/${locale}.json`)).pulse
      expect(pulse.qb_locked_body, `${locale} qb_locked_body`).toBeTruthy()
      expect(pulse.qb_see_plans, `${locale} qb_see_plans`).toBeTruthy()
    }
  })
})

describe('question bank reachability', () => {
  it('is linked from the monitor step', () => {
    // Without a link the page exists but nothing navigates to it, which is the
    // state the editor was already in.
    const monitor = code('components/dashboard/MonitorStep.tsx')

    expect(monitor).toContain('/dashboard/${clientId}/prompts')
    expect(monitor).toContain("tp('nav_questions')")
  })

  it('receives the locale it needs to build that link', () => {
    const monitor = code('components/dashboard/MonitorStep.tsx')
    const page = code('app/[lang]/dashboard/[clientId]/page.tsx')

    expect(monitor).toContain('lang: string')
    expect(page).toContain('<MonitorStep features={features} lang={lang}')
  })
})
