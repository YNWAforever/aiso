import { describe, expect, it, vi } from 'vitest'
import {
  parseCreateDraft,
  parseDraftEdit,
} from '@/lib/work-items/schema'
import { encodeWorkItemCursor, parseWorkItemListQuery } from '@/lib/work-items/query'

const ID = '123e4567-e89b-42d3-a456-426614174000'
const HASH = 'a'.repeat(64)

describe('work item input contracts', () => {
  it.each([
    [{kind:'pulse-metric',id:ID}, 'pulse-brand-absent.v1'],
    [{kind:'scan-check',id:ID,checkKey:'c1_robots'}, 'scan-check-gap.v1'],
    [{kind:'agent-recommendation',id:ID}, 'stored-recommendation.v1'],
  ] as const)('accepts the reserved %j source/rule pair', (source, ruleVersion) => {
    expect(parseCreateDraft({source,ruleVersion,fingerprint:HASH,locale:'en'})).toEqual({source,ruleVersion,fingerprint:HASH,locale:'en'})
  })

  it.each([
    {},
    {source:{kind:'pulse-metric',id:ID},ruleVersion:'scan-check-gap.v1',fingerprint:HASH,locale:'en'},
    {source:{kind:'pulse-metric',id:ID,checkKey:'c1_robots'},ruleVersion:'pulse-brand-absent.v1',fingerprint:HASH,locale:'en'},
    {source:{kind:'scan-check',id:ID},ruleVersion:'scan-check-gap.v1',fingerprint:HASH,locale:'en'},
    {source:{kind:'unknown',id:ID},ruleVersion:'pulse-brand-absent.v1',fingerprint:HASH,locale:'en'},
    {source:{kind:'pulse-metric',id:'bad'},ruleVersion:'pulse-brand-absent.v1',fingerprint:HASH,locale:'en'},
    {source:{kind:'pulse-metric',id:ID},ruleVersion:'pulse-brand-absent.v1',fingerprint:'A'.repeat(64),locale:'en'},
    {source:{kind:'pulse-metric',id:ID},ruleVersion:'pulse-brand-absent.v1',fingerprint:'a'.repeat(63),locale:'en'},
    {source:{kind:'pulse-metric',id:ID},ruleVersion:'pulse-brand-absent.v1',fingerprint:HASH,locale:'fr'},
    {source:{kind:'pulse-metric',id:ID},ruleVersion:'pulse-brand-absent.v1',fingerprint:HASH,locale:'en',title:'forged'},
  ])('rejects invalid create input %#', input => expect(() => parseCreateDraft(input)).toThrow('INVALID_WORK_ITEM_INPUT'))

  it('keeps create and edit parsers browser-safe when Buffer is unavailable', () => {
    vi.stubGlobal('Buffer', undefined)
    try {
      expect(parseCreateDraft({source:{kind:'pulse-metric',id:ID},ruleVersion:'pulse-brand-absent.v1',fingerprint:HASH,locale:'en'}).locale).toBe('en')
      expect(parseDraftEdit({title:'Review',action:'Check',notes:'',expectedRevision:1}).title).toBe('Review')
      expect(() => parseDraftEdit({title:'Review',action:'😀'.repeat(4000),notes:'😀'.repeat(8000),expectedRevision:1})).toThrow('INVALID_WORK_ITEM_INPUT')
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('normalizes editable text with trim and NFC', () => {
    expect(parseDraftEdit({title:' Cafe\u0301 ',action:' Review\n ',notes:' Note\u0301 ',expectedRevision:1}))
      .toEqual({title:'Café',action:'Review',notes:'Noté',expectedRevision:1})
  })

  it.each([
    {title:' ',action:'Review',notes:'',expectedRevision:1},
    {title:'Review',action:'\n',notes:'',expectedRevision:1},
    {title:'x'.repeat(161),action:'Review',notes:'',expectedRevision:1},
    {title:'Review',action:'x'.repeat(4001),notes:'',expectedRevision:1},
    {title:'Review',action:'Check',notes:'x'.repeat(8001),expectedRevision:1},
    {title:'Review',action:'Check',notes:'',expectedRevision:0},
    {title:'Review',action:'Check',notes:'',expectedRevision:Number.MAX_SAFE_INTEGER + 1},
    {title:'Review',action:'Check',notes:'',expectedRevision:1,evidenceSnapshot:{}},
  ])('rejects invalid edit input %#', input => expect(() => parseDraftEdit(input)).toThrow('INVALID_WORK_ITEM_INPUT'))

  it('accepts a positive future revision for conflict handling by the store', () => {
    expect(parseDraftEdit({title:'Review',action:'Check',notes:'',expectedRevision:2}).expectedRevision).toBe(2)
  })
  it('counts Unicode code points and rejects values over the UTF-8 request budget', () => {
    expect(parseDraftEdit({title:'😀'.repeat(160),action:'Check',notes:'',expectedRevision:1}).title).toHaveLength(320)
    expect(() => parseDraftEdit({title:'Review',action:'😀'.repeat(4000),notes:'😀'.repeat(8000),expectedRevision:1})).toThrow('INVALID_WORK_ITEM_INPUT')
  })

  it('parses a strict bounded list query and lossless cursor', () => {
    const cursor = encodeWorkItemCursor({createdAt:'2026-09-06T12:34:56.123456+00:00',id:ID})
    expect(parseWorkItemListQuery(new URLSearchParams({limit:'100',cursor}))).toEqual({limit:100,cursor:{createdAt:'2026-09-06T12:34:56.123456+00:00',id:ID}})
    expect(parseWorkItemListQuery(new URLSearchParams())).toEqual({limit:50,cursor:null})
  })

  it.each(['limit=0','limit=101','limit=1.5','unknown=x','limit=1&limit=2','cursor=bad'])('rejects invalid list query %s', query => {
    expect(() => parseWorkItemListQuery(new URLSearchParams(query))).toThrow('INVALID_WORK_ITEM_INPUT')
  })
})
