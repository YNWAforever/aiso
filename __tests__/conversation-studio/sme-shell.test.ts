import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('SME copilot single shell wiring', () => {
  it('renders Studio inside the dashboard chrome only under the flag', () => {
    const chrome = read('components/dashboard/shell/DashboardChrome.tsx')
    expect(chrome).toContain('smeCopilot = false')
    expect(chrome).toContain('if (studio && !smeCopilot)')
    const layout = read('app/[lang]/dashboard/layout.tsx')
    expect(layout).toContain('<DashboardChrome conversationStudio={conversationStudio} smeCopilot={smeCopilot}')
  })

  it('drops the Studio-owned rail only for the SME copilot, keeping the staff view intact', () => {
    const layout = read('app/[lang]/dashboard/[clientId]/studio/layout.tsx')
    expect(layout).toContain('isSmeCopilotUiEnabled()')
    expect(layout).toContain('const smeCopilot = !staff && isSmeCopilotUiEnabled()')
    expect(layout).toContain('<div id="aiso-studio">{children}</div>')
    expect(layout).toContain('<StudioShell')
    // The legacy path must still render StudioShell whenever the flag is off.
    expect(layout).toContain(': <StudioShell')
  })

  it('does not add a second sidebar or nav to the Chat landing', () => {
    const studio = read('components/dashboard/ConversationStudio.tsx')
    // Secondary Studio destinations are links in one disclosure, not a rail.
    expect(studio).toContain("t('chatMoreTitle')")
  })
})
