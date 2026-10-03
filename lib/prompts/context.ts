/** The existing onboarding markets; this does not introduce another UI locale. */
export const PROMPT_MARKETS = [
  { value: 'HK', labelEn: 'Hong Kong', labelZh: '香港' },
  { value: 'TW', labelEn: 'Taiwan', labelZh: '台灣' },
  { value: 'SG', labelEn: 'Singapore', labelZh: '新加坡' },
  { value: 'JP', labelEn: 'Japan', labelZh: '日本' },
  { value: 'KR', labelEn: 'South Korea', labelZh: '南韓' },
  { value: 'US', labelEn: 'United States', labelZh: '美國' },
  { value: 'UK', labelEn: 'United Kingdom', labelZh: '英國' },
  { value: 'EU', labelEn: 'European Union', labelZh: '歐盟' },
  { value: 'AU', labelEn: 'Australia', labelZh: '澳洲' },
  { value: 'CA', labelEn: 'Canada', labelZh: '加拿大' },
  { value: 'global', labelEn: 'Global', labelZh: '全球' },
] as const
export type PromptLanguage = 'en' | 'zh-HK'
export type PromptContext = { language: PromptLanguage; market: string | null }
export type PromptContextDefaults = { language?: unknown; market?: unknown }
export const isPromptLanguage = (value: unknown): value is PromptLanguage => value === 'en' || value === 'zh-HK'
export const isPromptMarket = (value: unknown): value is string => typeof value === 'string' && PROMPT_MARKETS.some(m => m.value === value)

/** Read compatibility only. Never rewrite an old code based on the UI locale. */
export function readPromptLanguage(value: unknown): PromptLanguage | null {
  if (isPromptLanguage(value)) return value
  if (value === 'en-US' || value === 'en-GB') return 'en'
  if (value === 'zh-Hant-HK') return 'zh-HK'
  return null
}
export function parsePromptContext(input: PromptContextDefaults, defaults: PromptContextDefaults = {}): PromptContext {
  const language = input.language === undefined ? readPromptLanguage(defaults.language) : input.language
  const market = input.market === undefined ? (isPromptMarket(defaults.market) ? defaults.market : null) : input.market
  if (!isPromptLanguage(language) || (market !== null && !isPromptMarket(market))) throw new Error('Invalid prompt context')
  return { language, market }
}
export function promptCollectionMessages(snapshot: { question: string; language: string | null; market: string | null; contextVersion?: string }): { role: 'system' | 'user'; content: string }[] {
  const question = { role: 'user' as const, content: snapshot.question }
  const language = readPromptLanguage(snapshot.language)
  // Old manifests keep their exact original provider input even during repair.
  if (snapshot.contextVersion !== '2026-10-03.v1' || !language) return [question]
  return [{ role: 'system', content: `Answer in ${language}. Market context: ${isPromptMarket(snapshot.market) ? snapshot.market : 'unspecified'}.` }, question]
}
