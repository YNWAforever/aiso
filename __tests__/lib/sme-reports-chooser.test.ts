import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('reports destination', () => {
  it('offers one report chooser instead of two separate create buttons for the copilot', () => {
    const page = readFileSync('app/[lang]/dashboard/[clientId]/reports/page.tsx', 'utf8')
    expect(page).toContain('report-chooser-title')
    expect(page).toContain("t('chooser_scan')")
    expect(page).toContain("t('chooser_monthly')")
    expect(page).toContain('/month/report')
    // The scan-only CTA stays for the legacy UI and is hidden under the flag.
    expect(page).toContain("kind === 'scan' && !isSmeCopilotUiEnabled()")
  })
})
