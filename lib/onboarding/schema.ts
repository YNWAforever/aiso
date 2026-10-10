import { createHash } from 'node:crypto'
import { isPromptCategory } from '@/lib/prompts/categories'
import { isPromptLanguage, parsePromptContext, type PromptLanguage, type PromptContext } from '@/lib/prompts/context'

export type OnboardingScope = { accountId: string }
export type SeedPrompt = { category: string; question: string; language: string; market?: string | null }
export type OnboardingInput = {
  intentKey: string; brandName: string; domain: string | null; industry: string | null; region: string | null;
  description: string | null; competitors: string[]; scanId: string | null; clientId: string | null;
  language: PromptLanguage | null; market: string | null;
}
export type OnboardingProgress = {
  clientId: string; brand: 'ready'; prompts: 'pending' | 'running' | 'ready' | 'failed'; promptCount: number;
  scanId: string | null; retryable: boolean; errorCode: string | null;
}
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function parseOnboardingInput(raw: Record<string, unknown>): OnboardingInput {
  if (typeof raw.brandName !== 'string' || !raw.brandName.trim() || raw.brandName.length > 160) throw new Error('brandName required')
  const text = (key: string, max: number) => {
    if (raw[key] == null || raw[key] === '') return null
    if (typeof raw[key] !== 'string' || raw[key].length > max) throw new Error('Invalid onboarding input')
    return raw[key].normalize('NFC').trim() || null
  }
  const brandName = raw.brandName.normalize('NFC').trim(), domain = text('domain', 255)
  const scanId = text('scanId', 36), clientId = text('clientId', 36)
  if ([scanId, clientId].some(id => id && !UUID.test(id))) throw new Error('Invalid onboarding input')
  const intentKey = text('intentKey', 128) ?? `legacy:${createHash('sha256').update(`${brandName.toLowerCase()}\n${domain ?? ''}`).digest('hex')}`
  if (raw.competitors !== undefined && (!Array.isArray(raw.competitors) || raw.competitors.length > 20
    || raw.competitors.some(value => typeof value !== 'string' || !value.trim() || value.length > 160))) throw new Error('Invalid onboarding input')
  // A legacy request may still save its brand. It cannot start a seed until
  // language is confirmed; missing context is not evidence of English.
  if (raw.language !== undefined && !isPromptLanguage(raw.language)) throw new Error('Invalid prompt context')
  const region = text('region', 20)
  const context = parsePromptContext({ language: raw.language ?? 'en', market: raw.market }, { market: region })
  return { intentKey, brandName, domain, scanId, clientId, industry: text('industry', 60), region,
    language: raw.language === undefined ? null : context.language, market: context.market,
    description: text('description', 4000), competitors: [...new Set((raw.competitors as string[] ?? []).map(value => value.trim()))] }
}
export function parseSeedPrompts(raw: string, context?: PromptContext): SeedPrompt[] {
  const match = raw.match(/\[[\s\S]*\]/)
  const parsed: unknown = JSON.parse(match?.[0] ?? raw)
  if (!Array.isArray(parsed)) throw new Error('ONBOARDING_SEED_INVALID')
  const unique = new Map<string, SeedPrompt>()
  for (const prompt of parsed) {
    if (!prompt || !isPromptCategory(prompt.category) || typeof prompt.question !== 'string'
      || !prompt.question.trim() || prompt.question.length > 1000) continue
    if (!isPromptLanguage(prompt.language)) throw new Error('ONBOARDING_SEED_CONTEXT_INVALID')
    const confirmed = parsePromptContext({ language: prompt.language, market: prompt.market }, context)
    if (context && (confirmed.language !== context.language || confirmed.market !== context.market)) throw new Error('ONBOARDING_SEED_CONTEXT_MISMATCH')
    const clean = { category: prompt.category, question: prompt.question.normalize('NFC').trim(), ...confirmed }
    unique.set(seedKey(clean), clean)
  }
  if (!unique.size) throw new Error('ONBOARDING_SEED_INVALID')
  return [...unique.values()].slice(0, 24)
}
export function seedKey(prompt: SeedPrompt): string {
  return createHash('sha256').update(JSON.stringify(prompt)).digest('hex')
}
