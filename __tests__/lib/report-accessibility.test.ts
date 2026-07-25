import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  reportInitialsForeground,
} from '@/components/reports/ReportPreview'
import { STATUS_BADGE_COLOR_PAIRS } from '@/components/reports/ReportStatusBadge'

describe('client report color accessibility', () => {
  it('keeps every status label at 4.5:1 or better in light and dark themes', () => {
    for (const [status, themes] of Object.entries(STATUS_BADGE_COLOR_PAIRS)) {
      for (const [theme, colors] of Object.entries(themes)) {
        expect(
          contrastRatio(colors.foreground, colors.background),
          `${status} ${theme}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('chooses a readable black or white foreground for arbitrary branding colors', () => {
    expect(reportInitialsForeground('#FFFFFF')).toBe('#000000')
    expect(reportInitialsForeground('#000000')).toBe('#FFFFFF')
    expect(contrastRatio(reportInitialsForeground('#777777'), '#777777')).toBeGreaterThanOrEqual(4.5)
  })
})
