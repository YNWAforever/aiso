import { describe, expect, it } from 'vitest'
import { observedValue } from '@/lib/integrations/analytics/value'

describe('observedValue', () => {
  it('computes from the string figures the driver returns', () => {
    expect(observedValue(37, { leadValue: '800', closeRate: '0.25' })).toBe(7400)
  })

  it('computes from numeric figures', () => {
    expect(observedValue(10, { leadValue: 500, closeRate: 0.5 })).toBe(2500)
  })

  it('rounds to a whole number', () => {
    expect(observedValue(1, { leadValue: '10', closeRate: '0.333' })).toBe(3)
  })

  it('treats a zero lead value as a real figure', () => {
    expect(observedValue(37, { leadValue: 0, closeRate: '0.25' })).toBe(0)
    expect(observedValue(37, { leadValue: '0', closeRate: '0.25' })).toBe(0)
  })

  it('treats a zero close rate as a real figure', () => {
    expect(observedValue(37, { leadValue: '800', closeRate: '0' })).toBe(0)
  })

  it('accepts the close rate bounds 0 and 1', () => {
    expect(observedValue(2, { leadValue: 100, closeRate: 1 })).toBe(200)
  })

  it('is zero for a zero count', () => {
    expect(observedValue(0, { leadValue: '800', closeRate: '0.25' })).toBe(0)
  })

  it.each([
    [null, '0.25'],
    ['800', null],
    [null, null],
    [undefined, '0.25'],
    ['800', undefined],
  ])('is null when a figure is missing (%s, %s)', (leadValue, closeRate) => {
    expect(observedValue(37, { leadValue, closeRate })).toBeNull()
  })

  it.each(['abc', NaN, Infinity, '', ' '])('is null for a non-finite lead value %s', leadValue => {
    expect(observedValue(37, { leadValue, closeRate: '0.25' })).toBeNull()
  })

  it.each(['abc', NaN, Infinity, ''])('is null for a non-finite close rate %s', closeRate => {
    expect(observedValue(37, { leadValue: '800', closeRate })).toBeNull()
  })

  it('is null for a close rate outside 0..1', () => {
    expect(observedValue(37, { leadValue: '800', closeRate: '1.5' })).toBeNull()
    expect(observedValue(37, { leadValue: '800', closeRate: '-0.1' })).toBeNull()
  })

  it('is null for a negative lead value', () => {
    expect(observedValue(37, { leadValue: '-1', closeRate: '0.25' })).toBeNull()
  })

  it('is null for a non-finite count', () => {
    expect(observedValue(NaN, { leadValue: '800', closeRate: '0.25' })).toBeNull()
  })
})
