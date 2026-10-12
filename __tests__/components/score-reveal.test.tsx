import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const intl = vi.hoisted(() => ({ locale: 'en' }))
vi.mock('next-intl', () => ({ useLocale: () => intl.locale }))

import { ScoreReveal } from '@/components/result/ScoreReveal'

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

import { assignGrade } from '@/lib/scoring'
it.each([49.97,59.97,63.5,69.97,79.97,89.97,0,50,60,70,80,90,100])('shows the exact score and scorer grade %s in both languages',score=>{
  for(const locale of ['en','zh-HK']) {
    intl.locale=locale
    const html=renderToStaticMarkup(<ScoreReveal score={score} grade={assignGrade(score)} domain="example.invalid" />)
    expect(html).toContain('>'+score+'/100</span>')
    expect(html).toContain('>'+assignGrade(score)+' <span')
  }
})
