import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { ScoreRing } from '@/components/visuals/ScoreRing'
import { PillarGauge } from '@/components/visuals/PillarGauge'
import { PotentialScoreBar } from '@/components/visuals/PotentialScoreBar'
import { CheckHeatmap } from '@/components/visuals/CheckHeatmap'
import { ScanTimeline } from '@/components/visuals/ScanTimeline'
import { Sparkline } from '@/components/visuals/Sparkline'
import { PlatformDots } from '@/components/visuals/PlatformDots'
import { AnimatedSteps } from '@/components/visuals/AnimatedStep'
import { HeroDemo } from '@/components/visuals/HeroDemo'
import { ScoreBadge } from '@/components/ui/score-badge'
import { StatCard } from '@/components/ui/stat-card'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTable } from '@/components/ui/data-table'
import { DesignSystemGallery } from '@/components/dev/DesignSystemGallery'
import { gradeTone, statusTone } from '@/components/visuals/tone'
import { groupCommands } from '@/components/ui/command-palette'

const catalogs = { en, 'zh-HK': zhHK } as const

function render(node: ReactElement, locale: keyof typeof catalogs = 'en') {
  return renderToStaticMarkup(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={catalogs[locale]}>{node}</NextIntlClientProvider>)
}

const checks = [
  { key: 'c1', label: 'robots.txt', status: 'pass', bucket: 'core' },
  { key: 'c2', label: 'llms.txt', status: 'fail', bucket: 'core' },
  { key: 'c8', label: 'Sitemap', status: 'warn', bucket: 'extended' },
  { key: 'c17', label: 'Citations', status: 'unknown', bucket: 'geo' },
] as const

describe('tones', () => {
  it('maps every grade and status, failing closed to neutral', () => {
    expect(gradeTone('A+')).toBe('success')
    expect(gradeTone('C')).toBe('warning')
    expect(gradeTone('F')).toBe('danger')
    expect(gradeTone('Z')).toBe('neutral')
    expect(statusTone('unknown')).toBe('neutral')
  })
})

describe('visuals carry a text alternative in both languages', () => {
  it('ScoreRing names score, grade and delta; static mode prints the final number', () => {
    const html = render(<ScoreRing score={68} grade="C" previous={64} animate={false} />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Score 68 out of 100, grade C, Fair. Up 4 since last time"')
    expect(html).toMatch(/>68<\/span>/)
    const zh = render(<ScoreRing score={68} grade="C" animate={false} />, 'zh-HK')
    expect(zh).toContain('分數 68／100，評級 C（一般）')
  })

  it('ScoreRing starts at zero on the server when animating, but its name already has the score', () => {
    const html = render(<ScoreRing score={79.5} grade="B" />)
    expect(html).toMatch(/>0<\/span>/)
    expect(html).toContain('Score 79.5 out of 100')
  })

  it('PillarGauge is a meter with its value text', () => {
    const html = render(<PillarGauge pillar="core" earned={38} animate={false} />)
    expect(html).toContain('role="meter"')
    expect(html).toContain('aria-valuenow="38"')
    expect(html).toContain('aria-valuemax="45"')
    expect(html).toContain('aria-valuetext="38 of 45 points"')
  })

  it('PotentialScoreBar states both scores and clamps the potential', () => {
    expect(render(<PotentialScoreBar current={68} potential={86} animate={false} />)).toContain('Score 68 now, 86 if the top fixes are done')
    expect(render(<PotentialScoreBar current={90} potential={70} animate={false} />)).toContain('Score 90 now, 90 if')
  })

  it('CheckHeatmap summarises and labels every tile with its status', () => {
    const html = render(<CheckHeatmap checks={checks} animate={false} />)
    expect(html).toContain('1 passed · 1 need work · 1 failed')
    expect(html).toContain('llms.txt: Fail')
    expect(html).toContain('Citations: Not checked')
    const buttons = render(<CheckHeatmap checks={checks} onSelect={() => {}} selectedKey="c2" animate={false} />)
    expect(buttons.match(/<button/g)).toHaveLength(4)
    expect(buttons).toContain('aria-pressed="true"')
  })

  it('ScanTimeline announces progress per pillar, not per check', () => {
    const html = render(<ScanTimeline checks={[
      { key: 'a', label: 'robots.txt', bucket: 'core', status: 'pass' },
      { key: 'b', label: 'Sitemap', bucket: 'extended', status: 'running' },
      { key: 'c', label: 'Citations', bucket: 'geo', status: 'pending' },
    ]} />)
    expect(html).toContain('1 of 3 checks done · Extended')
    expect(html.match(/aria-live/g)).toHaveLength(1)
    // The live region names only the pillar, so it changes per pillar, not per check.
    expect(html).toMatch(/<p aria-live="polite" class="sr-only">Checking Extended checks<\/p>/)
  })

  it('Sparkline summarises its direction', () => {
    expect(render(<Sparkline points={[50, 55, 62]} label="Score" />)).toContain('Score: up 12 over 3 points')
    expect(render(<Sparkline points={[9, 4]} label="Failing" />)).toContain('Failing: down 5 over 2 points')
    expect(render(<Sparkline points={[1]} label="x" />)).toBe('')
  })

  it('PlatformDots is a table with row and column headers', () => {
    const html = render(<PlatformDots caption="AI answers" platforms={[{ id: 'p', name: 'ChatGPT' }]} weeks={['W1', 'W2']} cells={{ p: ['cited'] }} />)
    expect(html).toContain('<caption class="sr-only">AI answers</caption>')
    expect(html).toContain('scope="row"')
    expect(html).toContain('Cited')
    expect(html).toContain('Not checked')
  })

  it('HeroDemo is decorative with one sentence for screen readers', () => {
    const html = render(<HeroDemo score={72} />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('scores 72 out of 100')
  })

  it('AnimatedSteps is a named ordered list', () => {
    const html = render(<AnimatedSteps label="How it works" steps={[{ icon: null, title: 'Scan' }, { icon: null, title: 'Fix' }]} animate={false} />)
    expect(html).toContain('<ol aria-label="How it works"')
    expect(html.match(/<li/g)).toHaveLength(2)
  })
})

describe('ui primitives', () => {
  it('command palette navigates in render order when groups are interleaved', () => {
    const { groups, ordered } = groupCommands([
      { id: 'a1', label: 'A1', group: 'A' }, { id: 'b1', label: 'B1', group: 'B' }, { id: 'a2', label: 'A2', group: 'A' },
    ])
    expect(groups.map(([group]) => group)).toEqual(['A', 'B'])
    expect(ordered.map(item => item.id)).toEqual(['a1', 'a2', 'b1'])
  })

  it('ScoreBadge prints the letter and the word, or a full name when the word is hidden', () => {
    expect(render(<ScoreBadge grade="A+" />)).toContain('Excellent')
    expect(render(<ScoreBadge grade="B" showLabel={false} />)).toContain('Grade B, Good')
  })

  it('StatCard reads the delta as a sentence and respects inverted metrics', () => {
    const html = render(<StatCard label="Failing" value="4" delta={-2} invertDelta />)
    expect(html).toContain('Down 2 since last time')
    expect(html).toContain('bg-tone-success-soft')
  })

  it('PageHeader marks the current crumb', () => {
    const html = render(<PageHeader title="Overview" breadcrumbs={[{ label: 'Acme', href: '/x' }, { label: 'Overview' }]} />)
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('aria-current="page"')
    expect(html.match(/<h1/g)).toHaveLength(1)
  })

  it('EmptyState has one heading and one action', () => {
    const html = render(<EmptyState title="No scans yet" action={<button>Scan</button>} />)
    expect(html).toContain('<h2')
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it('DataTable captions the table and falls back to the empty state', () => {
    const columns = [{ key: 'n', header: 'Name', cell: (r: { n: string }) => r.n, value: (r: { n: string }) => r.n }]
    expect(render(<DataTable caption="Brands" columns={columns} rows={[{ n: 'A' }]} getRowId={r => r.n} />)).toContain('<caption class="sr-only">Brands</caption>')
    expect(render(<DataTable caption="Brands" columns={columns} rows={[]} getRowId={r => r.n} empty={<p>none</p>} />)).toBe('<p>none</p>')
  })
})

describe('design-system gallery', () => {
  it('renders in both languages without an English fallback in zh-HK', () => {
    const en = render(<DesignSystemGallery />)
    const zh = render(<DesignSystemGallery />, 'zh-HK')
    expect(en).toContain('Design system')
    expect(zh).toContain('設計系統')
    expect(zh).not.toContain('Design system')
  })
})
