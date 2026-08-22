import { describe, expect, it } from 'vitest'
import {
  EMAIL_DAY1, EMAIL_DAY5, EMAIL_DAY7, EMAIL_DAY10,
  daysSinceTrialStart, pendingTrialEmails,
} from '@/lib/trial-emails'

// A little past the exact N-day mark, so the floor in daysSinceTrialStart
// cannot land one short due to the few milliseconds the test itself takes.
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000 - 60_000)
}

describe('daysSinceTrialStart', () => {
  it('accepts a Date, as the Neon driver returns for a timestamptz', () => {
    expect(daysSinceTrialStart(daysAgo(5))).toBe(5)
  })

  it('accepts an ISO string, as Supabase-era rows and test fixtures carry', () => {
    expect(daysSinceTrialStart(daysAgo(7).toISOString())).toBe(7)
  })

  it('is 0 on the day the trial starts', () => {
    expect(daysSinceTrialStart(new Date())).toBe(0)
  })
})

describe('pendingTrialEmails', () => {
  const appUrl = 'https://app.example.com'

  it('sends nothing before day 1', () => {
    expect(pendingTrialEmails(0, 0, appUrl)).toEqual([])
  })

  it('sends only day 1 at day 1 with nothing sent yet', () => {
    const due = pendingTrialEmails(1, 0, appUrl)

    expect(due).toHaveLength(1)
    expect(due[0].bit).toBe(EMAIL_DAY1)
    expect(due[0].subject).toContain('Fix Pack')
    expect(due[0].text).toContain(`${appUrl}/en/dashboard`)
  })

  it('does not resend day 1 once its bit is set', () => {
    expect(pendingTrialEmails(1, EMAIL_DAY1, appUrl)).toEqual([])
  })

  it('catches up on every email due at once, in order, if a run was missed', () => {
    const due = pendingTrialEmails(10, 0, appUrl)

    expect(due.map(e => e.bit)).toEqual([EMAIL_DAY1, EMAIL_DAY5, EMAIL_DAY7, EMAIL_DAY10])
  })

  it('sends only the ones not yet marked in the bitmask', () => {
    const due = pendingTrialEmails(10, EMAIL_DAY1 | EMAIL_DAY5, appUrl)

    expect(due.map(e => e.bit)).toEqual([EMAIL_DAY7, EMAIL_DAY10])
  })

  it('sends nothing once every bit is set', () => {
    const allSent = EMAIL_DAY1 | EMAIL_DAY5 | EMAIL_DAY7 | EMAIL_DAY10
    expect(pendingTrialEmails(100, allSent, appUrl)).toEqual([])
  })

  it('interpolates the app URL into every email body', () => {
    for (const email of pendingTrialEmails(10, 0, 'https://custom.example')) {
      expect(email.text).toContain('https://custom.example')
    }
  })
})
