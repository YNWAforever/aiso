import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'
import { PROMPT_CATEGORIES } from '@/lib/prompts/categories'
import { parseSeedPrompts, type OnboardingInput, type OnboardingScope } from './schema'
import { initializeOnboarding, readOnboardingProgress, claimOnboardingSeed, commitOnboardingSeed, failOnboardingSeed } from './store'

const SEED_FORMAT: JsonSchemaFormat = { name: 'seed_questions', schema: {
  type: 'object', properties: { questions: { type: 'array', items: {
    type: 'object', properties: { category: { type: 'string', enum: [...PROMPT_CATEGORIES] }, question: { type: 'string' }, language: { type: 'string' } },
    required: ['category', 'question', 'language'], additionalProperties: false,
  } } }, required: ['questions'], additionalProperties: false,
} }

export async function generateOnboardingSeed(input: OnboardingInput): Promise<string> {
  return callOpenRouter({ label: 'onboarding.seed_questions', model: 'anthropic/claude-haiku-4-5', maxTokens: 3000, responseFormat: SEED_FORMAT,
    messages: [{ role: 'user', content: `Brand: ${input.brandName}\nIndustry: ${input.industry ?? 'general'}\nDomain: ${input.domain ?? ''}\nDescription: ${input.description ?? ''}\nCompetitors: ${input.competitors.join(', ') || 'none specified'}\nGenerate 24 questions, 6 per category (${PROMPT_CATEGORIES.join(', ')}). Return a JSON array of {category,question,language}.` }] })
}
export async function completeOnboarding(scope: OnboardingScope, input: OnboardingInput,
  generate: (input: OnboardingInput) => Promise<string> = generateOnboardingSeed) {
  const initialized = await initializeOnboarding(scope, input)
  if (!initialized) return null
  const intentKey = initialized.intentKey
  const lease = await claimOnboardingSeed(scope, intentKey)
  if (lease) {
    try { await commitOnboardingSeed(scope, intentKey, lease.token, parseSeedPrompts(await generate(lease.input))) }
    catch { await failOnboardingSeed(scope, intentKey, lease.token, 'ONBOARDING_SEED_FAILED') }
  }
  return readOnboardingProgress(scope, intentKey)
}
