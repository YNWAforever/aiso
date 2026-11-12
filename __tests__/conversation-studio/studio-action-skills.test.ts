import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STUDIO_ACTION_SKILLS } from '@/lib/conversation-studio/skills'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/**
 * Slice 4 is a UI slice: the actions reuse write routes that already exist. These
 * assertions keep the confirm honest — one explicit click, no new endpoint, no
 * silent success — without booting a browser.
 */
describe('Studio action skills slice 4', () => {
  const studio = read('components/dashboard/ConversationStudio.tsx')
  const page = read('app/[lang]/dashboard/[clientId]/studio/page.tsx')

  it('reuses existing write paths and never invents an endpoint', () => {
    for (const skill of STUDIO_ACTION_SKILLS) {
      expect(skill.action).toBeTruthy()
      expect(skill.action!.endpoint.startsWith('/api/')).toBe(true)
    }
    expect(studio).toContain("fetch('/api/scan'")
    expect(studio).toContain('/agents/generate')
    expect(studio).toContain('/months/${hongKongMonthKey(new Date())}')
  })

  it('opens an inline confirm before running and blocks double submits', () => {
    expect(studio).toContain('studio-actions-title')
    expect(studio).toContain("role=\"group\"")
    expect(studio).toContain("actionPhase === 'running'")
    expect(studio).toContain('actions.runNow')
    expect(studio).toContain('actions.cancel')
    // The confirm copy names what will be written; the generic note says a tap alone runs nothing.
    expect(studio).toContain("t('actions.note')")
  })

  it('fails honestly instead of claiming success', () => {
    expect(studio).toContain("setActionPhase('failed')")
    expect(studio).toContain('role=\"alert\"')
    expect(studio).toContain('skills.${skillId}.${blocker}')
    expect(studio).toContain("trackFunnelEvent({ name: 'skill_action_failed'")
  })

  it('takes plan features and the brand domain from the server page', () => {
    expect(page).toContain('domain from clients')
    expect(page).toContain('brandDomain={brand.domain ?? null}')
    expect(page).toContain('features={resolveCommercialEntitlement(profile.accounts).features}')
  })

  it('never renders actions for a staff view', () => {
    expect(studio).toContain('smeCopilot && clientId && !staffView')
  })
})
