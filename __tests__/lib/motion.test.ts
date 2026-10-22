import { describe, expect, it } from 'vitest'
import { DURATION, EASE, EASE_CSS, MAX_STAGGER_TOTAL, countUpValue, exitTransition, staggerDelay } from '@/lib/motion'
import { readFileSync } from 'node:fs'

describe('motion vocabulary', () => {
  it('keeps UI durations within 150–300 ms and count-ups within 800 ms', () => {
    for (const key of ['micro', 'ui', 'enter', 'drawer'] as const) {
      expect(DURATION[key]).toBeGreaterThanOrEqual(0.15)
      expect(DURATION[key]).toBeLessThanOrEqual(0.3)
    }
    expect(DURATION.count).toBeLessThanOrEqual(0.8)
  })

  it('uses the same curve in JS and CSS', () => {
    expect(EASE_CSS).toBe(`cubic-bezier(${EASE.join(', ')})`)
    expect(readFileSync('app/globals.css', 'utf8')).toContain(`--ease-standard: ${EASE_CSS};`)
  })

  it('exits at 0.8× the entry duration', () => {
    expect(exitTransition(0.25).duration).toBe(0.2)
  })

  it('caps a stagger so the whole group lands within 400 ms', () => {
    for (const count of [2, 5, 10, 20, 60]) {
      expect(staggerDelay(0, count)).toBe(0)
      expect(staggerDelay(count - 1, count)).toBeLessThanOrEqual(MAX_STAGGER_TOTAL)
    }
    expect(staggerDelay(3, 5)).toBe(0.12)
  })

  it('counts up without ever overshooting the target', () => {
    for (let p = 0; p < 1; p += 0.05) expect(countUpValue(79.5, p, 2)).toBeLessThanOrEqual(79.5)
    expect(countUpValue(79.5, 1, 2)).toBe(79.5)
    expect(countUpValue(72, 0)).toBe(0)
  })
})
