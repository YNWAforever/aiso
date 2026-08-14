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
const PAGE = 'app/[lang]/dashboard/[clientId]/page.tsx'

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
    // results was the first step to need this; monitor and roi joined it on
    // restore, so the rule reads off BRAND_STEPS instead of naming one key.
    const sidebar = code(SIDEBAR)

    expect(sidebar).toContain("new Set(['results', 'monitor', 'roi'])")
    expect(sidebar).toContain('BRAND_STEPS.has(s.key) && !clientId')
  })
})

describe('monitor and roi navigation', () => {
  it('leaves no step the page renders but the sidebar cannot reach', () => {
    // The regression this catches shipped for real: 7b0cb9d removed the monitor
    // and roi entries while their targets were fenced, the page's step switch
    // went on rendering both, and MonitorStep and LocalTrustStep spent that
    // whole window reachable only by hand-typing ?step=. Derived from source on
    // both sides so adding a step to either file alone fails here.
    const rendered = new Set(
      [...code(PAGE).matchAll(/step === '(\w+)'/g)].map((m) => m[1]),
    )
    const linked = new Set(
      [...code(SIDEBAR).matchAll(/\{ key: '(\w+)'/g)].map((m) => m[1]),
    )

    expect([...linked].sort()).toEqual([...rendered].sort())
  })

  it('reuses the copy that outlived the removal in both locales', () => {
    // Same story as the question bank below: the keys were never deleted, so
    // restoring the entries needed no new translations.
    for (const locale of ['en', 'zh-HK'] as const) {
      const dashboard = JSON.parse(read(`messages/${locale}.json`)).dashboard
      for (const key of ['nav_monitor', 'nav_monitor_desc', 'nav_roi', 'nav_roi_desc']) {
        expect(dashboard[key], `${locale} ${key}`).toBeTruthy()
      }
    }
  })

  it('blocks navigation for a missing brand but not for a plan limit', () => {
    // A brand-less step has no target to reach; an unentitled one renders its
    // own locked card and pricing link, which pointer-events-none would hide.
    const sidebar = code(SIDEBAR)

    expect(sidebar).toContain('const blocksNavigation = unreachable')
    expect(sidebar).toContain('BRAND_STEPS.has(s.key) && !clientId')
    expect(sidebar).toContain("(s.key === 'roi' && !features.local_trust_roi)")
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
    // navigation would make that unreachable — the same carve-out the workflow
    // steps make for a plan limit. A Pro pill marks it instead.
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
