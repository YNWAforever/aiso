import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'
import { PROMPT_CATEGORIES } from '@/lib/prompts/categories'
import { parsePromptContext } from '@/lib/prompts/context'
import { parseSeedPrompts, type OnboardingInput, type OnboardingScope } from './schema'
import { initializeOnboarding, readOnboardingProgress, claimOnboardingSeed, commitOnboardingSeed, failOnboardingSeed } from './store'

const SEED_FORMAT: JsonSchemaFormat = { name: 'seed_questions', schema: {
  type: 'object', properties: { questions: { type: 'array', items: {
    type: 'object', properties: { category: { type: 'string', enum: [...PROMPT_CATEGORIES] }, question: { type: 'string' }, language: { type: 'string', enum: ['en','zh-HK'] } },
    required: ['category', 'question', 'language'], additionalProperties: false,
  } } }, required: ['questions'], additionalProperties: false,
} }

export async function generateOnboardingSeed(input: OnboardingInput): Promise<string> {
  const context = parsePromptContext(input)
  return callOpenRouter({ label: 'onboarding.seed_questions', model: 'anthropic/claude-haiku-4-5', maxTokens: 3000, responseFormat: SEED_FORMAT,
    messages: [{ role: 'user', content: `Brand: ${input.brandName}\nIndustry: ${input.industry ?? 'general'}\nDomain: ${input.domain ?? ''}\nDescription: ${input.description ?? ''}\nCompetitors: ${input.competitors.join(', ') || 'none specified'}\nLanguage: ${context.language}\nMarket: ${context.market ?? 'unspecified'}\nWrite every question in the confirmed language for the confirmed market. Do not infer language from the brand name. Generate 24 questions, 6 per category (${PROMPT_CATEGORIES.join(', ')}). Return {questions:[{category,question,language}]}, with language exactly ${context.language}.` }] })
}
export async function completeOnboarding(scope: OnboardingScope, input: OnboardingInput,
  generate: (input: OnboardingInput) => Promise<string> = generateOnboardingSeed) {
  const initialized = await initializeOnboarding(scope, input)
  if (!initialized) return null
  const intentKey = initialized.intentKey
  const lease = await claimOnboardingSeed(scope, intentKey)
  if (lease) {
    try { const context = parsePromptContext(lease.input)
      await commitOnboardingSeed(scope, intentKey, lease.token, parseSeedPrompts(await generate(lease.input), context)) }
    catch { await failOnboardingSeed(scope, intentKey, lease.token, 'ONBOARDING_SEED_FAILED') }
  }
  return readOnboardingProgress(scope, intentKey)
}
