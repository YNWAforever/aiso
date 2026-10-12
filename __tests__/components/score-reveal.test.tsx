import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const intl = vi.hoisted(() => ({ locale: 'en' }))
vi.mock('next-intl', () => ({ useLocale: () => intl.locale }))

import { ScoreReveal, formatScore } from '@/components/result/ScoreReveal'

// The result page showed "Avg. General B2C 47/100 · +26 vs avg" — taken from
// a hard-coded table with no data behind it, presented as a measured
// industry average. No such comparison may be rendered until one exists.
describe('ScoreReveal', () => {
  it.each([
    ['en', /Avg\.|vs avg|average/i],
    ['zh-HK', /平均/],
  ])('does not present an invented industry average (%s)', (locale, pattern) => {
    intl.locale = locale
    const html = renderToStaticMarkup(
      <ScoreReveal score={73} grade="B" domain="www.example.com" industry="general_b2c" region="global" />,
    )

    expect(html).not.toMatch(pattern)
    expect(html).not.toContain('47/100')
    expect(html).toContain('73/100')
  })
})

describe('formatScore', () => {
  it.each([
    [74, '74'],
    [63.5, '63.5'],
    [89.97, '89.97'],
    [9.72, '9.72'],
  ])('keeps the stored two-decimal precision: %s -> %s', (score, expected) => {
    expect(formatScore(score)).toBe(expected)
  })

  it('never rounds a score across a grade boundary', () => {
    intl.locale = 'en'
    const html = renderToStaticMarkup(<ScoreReveal score={89.97} grade="A" domain="example.test" />)
    expect(html).toContain('89.97/100')
    expect(html).not.toContain('90.0')
  })
})
