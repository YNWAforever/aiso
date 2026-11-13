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
  const studio = read('components/dashboard/StudioActionPanel.tsx')
  const transport = read('lib/conversation-studio/action-outcomes.ts')
  const page = read('app/[lang]/dashboard/[clientId]/studio/page.tsx')

  it('reuses existing write paths and never invents an endpoint', () => {
    for (const skill of STUDIO_ACTION_SKILLS) {
      expect(skill.action).toBeTruthy()
      expect(skill.action!.endpoint.startsWith('/api/')).toBe(true)
    }
    expect(transport).toContain("request('/api/scan'")
    expect(transport).toContain('/agents/generate')
    expect(transport).toContain('/months/${encodeURIComponent(scope.month')
  })

  it('opens an inline confirm before running and blocks double submits', () => {
    expect(studio).toContain('studio-actions-title')
    expect(studio).toContain("role=\"group\"")
    expect(studio).toContain('writing.current = true')
    expect(studio).toContain('disabled={busy}')
    expect(studio).toContain('actions.runNow')
    expect(studio).toContain('actions.cancel')
    // The confirm copy names what will be written; the generic note says a tap alone runs nothing.
    expect(studio).toContain("t('actions.note')")
  })

  it('fails honestly instead of claiming success', () => {
    expect(transport).toContain("phase: 'unknown'")
    expect(studio).toContain("state.phase === 'unknown' ? t('actions.unknown')")
    expect(studio).toContain('skills.${id}.${blocker}')
    expect(studio).toContain("trackFunnelEvent({ name: 'skill_action_failed'")
  })

  it('takes plan features and the brand domain from the server page', () => {
    expect(page).toContain('domain from clients')
    expect(page).toContain('brandDomain={brand.domain ?? null}')
    expect(page).toContain('features={resolveCommercialEntitlement(profile.accounts).features}')
  })

  it('records a completed action as a saved turn composed by the server', () => {
    expect(studio).toContain('async function saveAction')
    expect(studio).toContain('requestId: crypto.randomUUID()')
    expect(studio).toContain('await saveAction(outcome)')
    expect(studio).toContain('turnPrompt')
    expect(studio).toContain('saveThread(threadId')
  })

  it('never renders actions for a staff view', () => {
    expect(read('components/dashboard/ConversationStudio.tsx')).toContain('enabled: smeCopilot && !staffView')
  })
})
