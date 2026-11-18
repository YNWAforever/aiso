import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

describe('onboarding never shows the server error string', () => {
  const source = readFileSync('components/onboarding/OnboardingWizard.tsx', 'utf8')
  it('maps every failure through translated copy', () => {
    // The API answers with internal English ("Claim unavailable", "Scan belongs to another account").
    expect(source).not.toMatch(/setError\(\s*typeof\s+(data|body)\.error/)
    expect(source).toContain('serverError(res.status, data.error)')
  })
  it('has every error message in both locales', () => {
    for (const key of Object.keys(en.onboardingWizard.errors)) {
      expect(zh.onboardingWizard.errors[key as keyof typeof zh.onboardingWizard.errors]).toBeTruthy()
    }
  })
})
