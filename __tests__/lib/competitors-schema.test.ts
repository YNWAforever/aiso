import { describe, it, expect } from 'vitest'
import { MAX_COMPETITORS, mergeCompetitorRefs, parseCompetitorInput } from '@/lib/competitors/schema'

describe('parseCompetitorInput', () => {
  it('trims the name and normalises aliases and domains', () => {
    expect(parseCompetitorInput({
      name: '  HSBC Holdings ',
      aliases: [' HSBC ', '匯豐', 'hsbc', 'HSBC Holdings', ''],
      domains: ['https://www.HSBC.com.hk/en/', 'hsbc.com', 'HSBC.com'],
    })).toEqual({ ok: true, value: {
      name: 'HSBC Holdings',
      aliases: ['HSBC', '匯豐'],
      domains: ['hsbc.com.hk', 'hsbc.com'],
    } })
  })

  it('defaults missing aliases and domains to empty', () => {
    expect(parseCompetitorInput({ name: 'Acme' })).toEqual({ ok: true, value: { name: 'Acme', aliases: [], domains: [] } })
  })

  it.each([
    [{}, 'name_required'],
    [{ name: '   ' }, 'name_required'],
    [{ name: 'x'.repeat(121) }, 'name_too_long'],
    [{ name: 'Acme', aliases: 'Acme Co' }, 'invalid_aliases'],
    [{ name: 'Acme', aliases: [1] }, 'invalid_aliases'],
    [{ name: 'Acme', aliases: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'too_many_aliases'],
    [{ name: 'Acme', aliases: ['x'.repeat(121)] }, 'invalid_aliases'],
    [{ name: 'Acme', domains: ['not a domain'] }, 'invalid_domain'],
    [{ name: 'Acme', domains: ['localhost'] }, 'invalid_domain'],
    [{ name: 'Acme', domains: ['10.0.0.1'] }, 'invalid_domain'],
    [{ name: 'Acme', domains: ['ftp://acme.com'] }, 'invalid_domain'],
    [{ name: 'Acme', domains: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'] }, 'too_many_domains'],
    [null, 'invalid_body'],
    [['Acme'], 'invalid_body'],
  ])('refuses %j with %s', (body, error) => {
    expect(parseCompetitorInput(body)).toEqual({ ok: false, error })
  })

  it('a partial update validates only the fields it carries', () => {
    expect(parseCompetitorInput({ aliases: ['AC'] }, { partial: true })).toEqual({ ok: true, value: { aliases: ['AC'] } })
    expect(parseCompetitorInput({}, { partial: true })).toEqual({ ok: false, error: 'nothing_to_update' })
    expect(parseCompetitorInput({ name: '' }, { partial: true })).toEqual({ ok: false, error: 'name_required' })
  })
})

describe('mergeCompetitorRefs', () => {
  it('keeps table rows with their aliases and adds array-only names, case-insensitively once', () => {
    expect(mergeCompetitorRefs(['Acme', 'Globex', 'acme', ' '], [{ name: 'ACME', aliases: ['Acme Co'] }])).toEqual([
      { name: 'ACME', aliases: ['Acme Co'] },
      { name: 'Globex', aliases: [] },
    ])
  })

  it('caps the result at the classifier limit', () => {
    const names = Array.from({ length: 15 }, (_, i) => `Brand ${i}`)
    expect(mergeCompetitorRefs(names, [])).toHaveLength(MAX_COMPETITORS)
  })

  it('tolerates a missing array and malformed rows', () => {
    expect(mergeCompetitorRefs(null, [{ name: 'Acme', aliases: null }, { name: '' }] as never)).toEqual([{ name: 'Acme', aliases: [] }])
  })
})
