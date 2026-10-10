import { describe, it, expect } from 'vitest'
import { buildShareOfVoice, shareOfVoiceCsv, type SovAnswer } from '@/lib/pulse/share-of-voice'

const answer = (overrides: Partial<SovAnswer>): SovAnswer => ({
  scan_week: '2026-10-05', platform: 'gpt-4o', prompt_id: 'p1', question: 'Best bank in Hong Kong?',
  brand_mentioned: false, competitors_mentioned: [], ...overrides,
})

const refs = [{ name: 'HSBC Holdings', aliases: ['HSBC', '匯豐'] }, { name: 'Hang Seng Bank', aliases: [] }]

describe('buildShareOfVoice', () => {
  const view = buildShareOfVoice({
    brandName: 'Fimmick Bank',
    refs,
    answers: [
      // Latest week: 4 answers across two platforms and two questions.
      answer({ brand_mentioned: true, competitors_mentioned: ['HSBC Holdings'] }),
      answer({ platform: 'gemini-flash', competitors_mentioned: ['hsbc', 'Hang Seng Bank'] }),
      answer({ prompt_id: 'p2', question: 'Cheapest mortgage?', brand_mentioned: true, competitors_mentioned: ['Citi'] }),
      answer({ prompt_id: 'p2', question: 'Cheapest mortgage?', platform: 'gemini-flash', competitors_mentioned: ['匯豐', 'HSBC'] }),
      // Previous week: 2 answers.
      answer({ scan_week: '2026-09-28', brand_mentioned: true }),
      answer({ scan_week: '2026-09-28', platform: 'gemini-flash', competitors_mentioned: ['HSBC Holdings'] }),
    ],
  })
  const subject = (label: string) => view.subjects.find(s => s.label === label)!

  it('orders weeks newest first and lists the platforms seen', () => {
    expect(view.weeks).toEqual(['2026-10-05', '2026-09-28'])
    expect(view.platforms).toEqual(['gemini-flash', 'gpt-4o'])
  })

  it('reports the brand first, then every configured competitor, then other named brands', () => {
    expect(view.subjects.map(s => [s.kind, s.label])).toEqual([
      ['brand', 'Fimmick Bank'], ['competitor', 'HSBC Holdings'], ['competitor', 'Hang Seng Bank'], ['other', 'Citi'],
    ])
  })

  it('counts an answer once per subject, folding aliases and case into the canonical competitor', () => {
    // Answer 4 names HSBC twice (匯豐 and HSBC): one mention, not two.
    expect(subject('HSBC Holdings').cells['2026-10-05']['*']).toEqual({ mentions: 3, answers: 4, share: 75 })
    expect(subject('Hang Seng Bank').cells['2026-10-05']['*']).toEqual({ mentions: 1, answers: 4, share: 25 })
    expect(subject('Fimmick Bank').cells['2026-10-05']['*']).toEqual({ mentions: 2, answers: 4, share: 50 })
  })

  it('breaks each week down by platform', () => {
    expect(subject('Fimmick Bank').cells['2026-10-05']['gpt-4o']).toEqual({ mentions: 2, answers: 2, share: 100 })
    expect(subject('Fimmick Bank').cells['2026-10-05']['gemini-flash']).toEqual({ mentions: 0, answers: 2, share: 0 })
  })

  it('reports the change against the previous week in percentage points', () => {
    expect(subject('Fimmick Bank').change).toBe(0)     // 50% then 50%
    expect(subject('HSBC Holdings').change).toBe(25)   // 50% then 75%
    expect(subject('Citi').change).toBe(25)            // a 0-of-2 week is a real 0%, not missing
  })

  it('summarises the latest week per question', () => {
    expect(view.prompts).toEqual([
      { promptId: 'p1', question: 'Best bank in Hong Kong?', answers: 2, brandMentions: 1,
        competitors: [{ label: 'HSBC Holdings', mentions: 2 }, { label: 'Hang Seng Bank', mentions: 1 }] },
      { promptId: 'p2', question: 'Cheapest mortgage?', answers: 2, brandMentions: 1,
        competitors: [{ label: 'Citi', mentions: 1 }, { label: 'HSBC Holdings', mentions: 1 }] },
    ])
  })

  it('never lists the brand itself as another brand', () => {
    const own = buildShareOfVoice({ brandName: 'Fimmick Bank', refs: [], answers: [answer({ brand_mentioned: true, competitors_mentioned: ['fimmick bank'] })] })
    expect(own.subjects.map(s => s.label)).toEqual(['Fimmick Bank'])
  })

  it('keeps at most five unconfigured brands, by latest-week mentions', () => {
    const many = buildShareOfVoice({ brandName: 'X', refs: [], answers: [
      answer({ competitors_mentioned: ['A', 'B', 'C', 'D', 'E', 'F'] }),
      answer({ competitors_mentioned: ['F'] }),
    ] })
    expect(many.subjects.filter(s => s.kind === 'other').map(s => s.label)).toEqual(['F', 'A', 'B', 'C', 'D'])
  })

  it('is empty, not zero, with no answers', () => {
    const empty = buildShareOfVoice({ brandName: 'X', refs, answers: [] })
    expect(empty.weeks).toEqual([])
    expect(empty.subjects.every(s => Object.keys(s.cells).length === 0 && s.change === null)).toBe(true)
    expect(empty.prompts).toEqual([])
  })

  it('caps the history at eight weeks', () => {
    const weeks = Array.from({ length: 10 }, (_, i) => `2026-0${Math.floor(i / 3) + 1}-0${(i % 3) + 1}`)
    expect(buildShareOfVoice({ brandName: 'X', refs: [], answers: weeks.map(scan_week => answer({ scan_week })) }).weeks).toHaveLength(8)
  })
})

describe('shareOfVoiceCsv', () => {
  const view = buildShareOfVoice({ brandName: 'Fimmick, "the bank"', refs: [{ name: '=HYPERLINK("x")', aliases: [] }], answers: [
    answer({ brand_mentioned: true, competitors_mentioned: ['=HYPERLINK("x")'] }),
  ] })
  const csv = shareOfVoiceCsv(view)
  const lines = csv.trim().split('\r\n')

  it('writes one row per week, platform and subject with a header', () => {
    expect(lines[0]).toBe('week,platform,subject,type,mentions,answers,share_percent')
    expect(lines).toContain('2026-10-05,all,"Fimmick, ""the bank""",brand,1,1,100')
    expect(lines).toContain('2026-10-05,gpt-4o,"Fimmick, ""the bank""",brand,1,1,100')
  })

  it('neutralises spreadsheet formulas in names', () => {
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m)
    expect(lines).toContain(`2026-10-05,all,"'=HYPERLINK(""x"")",competitor,1,1,100`)
  })
})
