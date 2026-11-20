import { describe, expect, it } from 'vitest'
import { buildTrialEmail, EMAIL_DAY1, EMAIL_DAY5, EMAIL_DAY7, EMAIL_DAY10 } from '@/lib/trial-emails'

const expiry = new Date('2026-11-30T12:30:00Z')
const origin = 'https://app.example.test'

describe('trial email copy', () => {
  it.each([EMAIL_DAY5, EMAIL_DAY7] as const)('quotes the catalog price and first charge for milestone %s', bit => {
    const english = buildTrialEmail(bit, expiry, 'en', origin)
    expect(english.text).toContain('USD 199 per month')
    expect(english.text).toContain('complete checkout')
    expect(english.text).toContain(`${origin}/en/pricing`)
    const chinese = buildTrialEmail(bit, expiry, 'zh-HK', origin)
    expect(chinese.text).toContain('199 美元')
    expect(chinese.text).toContain('香港時間')
  })

  it('links the workspace from the first message without deployment or indexing claims', () => {
    const email = buildTrialEmail(EMAIL_DAY1, expiry, 'en', origin)
    expect(email.text).toContain(`${origin}/en/dashboard`)
    expect(email.text).not.toMatch(/ready to deploy|indexing/i)
  })

  it('uses expired wording for the follow-up', () => {
    expect(buildTrialEmail(EMAIL_DAY10, expiry, 'en', origin).subject).toContain('has ended')
  })
})
