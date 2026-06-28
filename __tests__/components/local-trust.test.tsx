import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LocalTrustStep } from '@/components/dashboard/local-trust/LocalTrustStep'

const repoRoot = process.cwd()

function read(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8')
}

describe('Local Trust dashboard wiring', () => {
  it('adds ROI as the fifth dashboard workflow step', () => {
    const sidebar = read('components/dashboard/DashboardSidebar.tsx')
    const page = read('app/[lang]/dashboard/[clientId]/page.tsx')

    expect(sidebar).toContain("key: 'roi'")
    expect(sidebar.indexOf("key: 'monitor'")).toBeLessThan(sidebar.indexOf("key: 'roi'"))
    expect(sidebar).toContain('nav_roi')
    expect(sidebar).toContain('TrendingUp')
    expect(page).toContain("step === 'roi'")
    expect(page).toContain('LocalTrustStep')
  })

  it('keeps Local Trust ROI visible but locked for plans without access', () => {
    const sidebar = read('components/dashboard/DashboardSidebar.tsx')
    const progress = read('components/dashboard/WizardProgress.tsx')

    expect(sidebar).toContain("s.key === 'roi' && !features.local_trust_roi")
    expect(sidebar).toContain("const blocksNavigation = locked && s.key !== 'roi'")
    expect(sidebar).toContain('blocksNavigation')
    expect(progress).toContain("key: 'roi'")
    expect(progress).toContain('features.local_trust_roi')
    expect(progress).toContain('Local Trust ROI')
  })

  it('renders a Basic locked preview with sample movement and a pricing CTA', () => {
    const html = renderToStaticMarkup(
      <LocalTrustStep
        lang="en"
        clientId="client_123"
        plan="basic"
        profile={null}
        snapshot={null}
        actions={[]}
        competitors={[]}
      />
    )

    expect(html).toContain('62')
    expect(html).toContain('71')
    expect(html).toContain('Upgrade to Pro')
    expect(html).toContain('/en/pricing')
  })

  it('fetches Local Trust data only for the ROI step using account-scoped helpers', () => {
    const page = read('app/[lang]/dashboard/[clientId]/page.tsx')

    expect(page).toContain("select('id, brand_name, domain, industry, competitors, status, created_at')")
    expect(page).toContain("getLocalTrustProfile(clientId, profile.account_id)")
    expect(page).toContain("step === 'roi' && features.local_trust_roi")
    expect(page).toContain('getOrCreateLocalTrustSnapshot')
    expect(page).toContain('accountId: profile.account_id')
    expect(page).toContain('const typedClient = client as Client')
    expect(page).toContain('client: typedClient')
  })

  it('contains English and Traditional Chinese Local Trust copy keys', () => {
    const en = read('messages/en.json')
    const zh = read('messages/zh-HK.json')

    for (const messages of [en, zh]) {
      expect(messages).toContain('step_roi_title')
      expect(messages).toContain('step_roi_body')
      expect(messages).toContain('step_roi_locked')
      expect(messages).toContain('nav_roi')
      expect(messages).toContain('nav_roi_desc')
      expect(messages).toContain('local_trust_score')
    }
  })
})
