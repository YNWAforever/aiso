import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('client report workspace review fixes', () => {
  it('adds a route loading state and preserves partial metrics explicitly', () => {
    const loadingPath = join(
      process.cwd(),
      'app/[lang]/dashboard/[clientId]/reports/loading.tsx',
    )
    const pageSource = readFileSync(
      join(process.cwd(), 'app/[lang]/dashboard/[clientId]/reports/page.tsx'),
      'utf8',
    )

    expect(existsSync(loadingPath)).toBe(true)
    expect(pageSource).toContain('metricsUnavailable')
  })

  it('keeps exactly one filled primary action in the scan-result header', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx'),
      'utf8',
    )
    const header = source.slice(
      source.indexOf('{/* Top nav bar */}'),
      source.indexOf('<main'),
    )

    expect(header.match(/(?:^|\s)bg-primary(?=\s)/g)).toHaveLength(1)
    expect(header).toContain('border border-dash-border')
    expect(header).toContain('focus-visible:ring-2')
  })
})
