import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

/** Source with comments stripped, so prose cannot satisfy a behavioural check. */
function code(path: string) {
  return read(path)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const SIDEBAR = 'components/dashboard/DashboardSidebar.tsx'
const LAYOUT = 'app/[lang]/dashboard/layout.tsx'

describe('dashboard sidebar brand resolution', () => {
  it('no longer depends on the header Next 16 does not set', () => {
    // The layout read `x-invoke-path`, a Next 13-era internal. Nothing in the
    // app sets it and it is gone from Next's own source, so the regex never
    // matched: brandId was permanently undefined, every nav link dropped the
    // brand, and the results entry was locked and unclickable forever.
    expect(code(LAYOUT)).not.toContain('x-invoke-path')
    expect(code(LAYOUT)).not.toContain("from 'next/headers'")
  })

  it('reads the brand from the route it renders inside', () => {
    const sidebar = code(SIDEBAR)

    expect(sidebar).toContain('useParams<{ lang: string; clientId?: string }>()')
    expect(sidebar).toContain('const clientId = params?.clientId ?? brandId')
  })

  it('builds every workflow link against that id', () => {
    // The bug's user-visible symptom: links resolved to the brand-less
    // /dashboard, losing the brand on every navigation.
    const sidebar = code(SIDEBAR)

    expect(sidebar).toContain('clientId ? `/${lang}/dashboard/${clientId}?step=${s.key}`')
    expect(sidebar).not.toContain('brandId ? `/${lang}/dashboard/${brandId}')
  })

  it('unlocks results once a brand is in the route', () => {
    expect(code(SIDEBAR)).toContain("(s.key === 'results' && !clientId)")
  })
})

describe('question bank navigation', () => {
  it('links the question bank from the sidebar', () => {
    const sidebar = code(SIDEBAR)

    expect(sidebar).toContain('/${lang}/dashboard/${clientId}/prompts')
    expect(sidebar).toContain("t('question_bank')")
    expect(sidebar).toContain("t('tools')")
  })

  it('reuses the copy that was already translated in both locales', () => {
    // dashboard.tools and dashboard.question_bank survived 7b0cb9d, which
    // removed the link because its target was fenced, not because the shape was
    // wrong. No new keys needed.
    for (const locale of ['en', 'zh-HK'] as const) {
      const dashboard = JSON.parse(read(`messages/${locale}.json`)).dashboard
      expect(dashboard.tools, `${locale} tools`).toBeTruthy()
      expect(dashboard.question_bank, `${locale} question_bank`).toBeTruthy()
    }
  })

  it('stays clickable for a plan without edit_prompts', () => {
    // The page renders its own locked card and a pricing link, so blocking
    // navigation would make that unreachable — the same carve-out the roi entry
    // had before it was removed. A Pro pill marks it instead.
    const sidebar = code(SIDEBAR)
    const tools = sidebar.slice(sidebar.indexOf("t('tools')"))

    expect(tools).not.toContain('pointer-events-none')
    expect(tools).toContain('!features.edit_prompts')
  })

  it('marks itself active on its own route rather than leaving Scan highlighted', () => {
    // Sub-routes carry no ?step=, so `step` falls back to 'scan' and the Scan
    // entry would otherwise render as active while the user is on the bank.
    const sidebar = code(SIDEBAR)

    expect(sidebar).toContain('usePathname')
    expect(sidebar).toContain('const active = !onSubRoute && step === s.key')
    expect(sidebar).toContain("pathname?.endsWith('/prompts')")
  })
})
