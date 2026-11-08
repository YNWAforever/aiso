import {normalizeCitationUrl} from '@/lib/citations/normalize'
import {normalizeScanUrl} from '@/lib/scan-input'
import {normalizeVerificationDomain} from '@/lib/domain-verification/schema'
import {readIndustry} from './industry'
import { createHash } from 'node:crypto'
import { isPromptCategory } from '@/lib/prompts/categories'
import { isPromptLanguage, parsePromptContext, type PromptLanguage, type PromptContext } from '@/lib/prompts/context'
import { MAX_COMPETITORS, MAX_NAME_LENGTH } from '@/lib/competitors/limits'
import { competitorKey, competitorName } from './competitors'

export type OnboardingScope = { accountId: string }
export type SeedPrompt = { category: string; question: string; language: string; market?: string | null }
/** A competitor's website, which is what lets a citation be attributed to it. */
export type OnboardingCompetitorDomain = { name: string; domain: string }
export type OnboardingInput = {
  intentKey: string; brandName: string; domain: string | null; industry: string | null; region: string | null;
  description: string | null; competitors: string[]; competitorDomains: OnboardingCompetitorDomain[];
  scanId: string | null; clientId: string | null;
  language: PromptLanguage | null; market: string | null;
}
export type OnboardingProgress = {
  clientId: string; brand: 'ready'; prompts: 'pending' | 'running' | 'ready' | 'failed'; promptCount: number;
  scanId: string | null; retryable: boolean; errorCode: string | null;
}
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
/**
 * Competitor names arrive from the wizard, but the request body is caller
 * supplied: validate shape, bound the list to the shared caps, normalise
 * Unicode and refuse the brand itself. A name the classifier would never match
 * is a validation error, never stored and silently ignored.
 */
function parseCompetitors(raw: unknown, brandName: string): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_COMPETITORS
    || raw.some(value => typeof value !== 'string' || !value.trim() || value.length > MAX_NAME_LENGTH)) {
    throw new Error('COMPETITORS_INVALID')
  }
  const brand = competitorKey(brandName)
  const seen = new Set<string>()
  const competitors: string[] = []
  for (const value of raw) {
    const name = competitorName(value)
    const key = competitorKey(name)
    if (key === brand) throw new Error('COMPETITORS_INVALID')
    if (seen.has(key)) continue
    seen.add(key)
    competitors.push(name)
  }
  return competitors
}
/**
 * Competitor websites, keyed by competitor name. A domain that is not the
 * brand's own, is unparseable, or names a competitor that was not supplied is
 * rejected rather than dropped: the array and the table must agree with what
 * the member sees, or a citation is silently attributed to nobody.
 */
function parseCompetitorDomains(raw: unknown, competitors: readonly string[]): OnboardingCompetitorDomain[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_COMPETITORS) throw new Error('COMPETITORS_INVALID')
  const canonical = new Map(competitors.map(name => [competitorKey(name), name]))
  const seen = new Set<string>()
  const domains: OnboardingCompetitorDomain[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COMPETITORS_INVALID')
    const entry = value as Record<string, unknown>
    if (typeof entry.name !== 'string' || typeof entry.domain !== 'string') throw new Error('COMPETITORS_INVALID')
    const key = competitorKey(competitorName(entry.name))
    const name = canonical.get(key)
    if (!name || seen.has(key) || !entry.domain.trim() || entry.domain.length > 255) throw new Error('COMPETITORS_INVALID')
    const normalized = normalizeVerificationDomain(entry.domain)
    if (!normalized) throw new Error('COMPETITORS_INVALID')
    seen.add(key)
    domains.push({ name, domain: normalized.replace(/^www\./, '') })
  }
  return domains
}
export function parseOnboardingInput(raw: Record<string, unknown>): OnboardingInput {
  if (typeof raw.brandName !== 'string' || !raw.brandName.trim() || raw.brandName.length > 160) throw new Error('brandName required')
  const text = (key: string, max: number) => {
    if (raw[key] == null || raw[key] === '') return null
    if (typeof raw[key] !== 'string' || raw[key].length > max) throw new Error('Invalid onboarding input')
    return raw[key].normalize('NFC').trim() || null
  }
  const brandName = raw.brandName.normalize('NFC').trim(), domainInput = text('domain', 255)
  const verifiedDomain=domainInput?normalizeVerificationDomain(normalizeScanUrl(domainInput)):null
  const normalizedDomainUrl=verifiedDomain?normalizeCitationUrl('https://'+verifiedDomain):null
  const domain=normalizedDomainUrl?new URL(normalizedDomainUrl).hostname:null
  if(domainInput&&!domain)throw new Error('Invalid domain')
  const scanId = text('scanId', 36), clientId = text('clientId', 36)
  if ([scanId, clientId].some(id => id && !UUID.test(id))) throw new Error('Invalid onboarding input')
  const intentKey = text('intentKey', 128) ?? `legacy:${createHash('sha256').update(`${brandName.toLowerCase()}\n${domain ?? ''}`).digest('hex')}`
  const competitors = parseCompetitors(raw.competitors, brandName)
  const competitorDomains = parseCompetitorDomains(raw.competitorDomains, competitors)
  // A legacy request may still save its brand. It cannot start a seed until
  // language is confirmed; missing context is not evidence of English.
  if (raw.language !== undefined && !isPromptLanguage(raw.language)) throw new Error('Invalid prompt context')
  const region = text('region', 20)
  const context = parsePromptContext({ language: raw.language ?? 'en', market: raw.market }, { market: region })
  return { intentKey, brandName, domain, scanId, clientId, industry: readIndustry(text('industry', 60)), region,
    language: raw.language === undefined ? null : context.language, market: context.market,
    description: text('description', 4000), competitors, competitorDomains }
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

export function onboardingInputHash(input:OnboardingInput):string {const {intentKey:_intent,clientId:_client,...payload}=input;void _intent;void _client;return createHash('sha256').update(JSON.stringify(payload)).digest('hex')}
