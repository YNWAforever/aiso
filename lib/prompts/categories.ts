/**
 * The four categories the question bank is organised by.
 *
 * This is the single source of truth. It previously existed in three places that
 * disagreed: the string in the onboarding LLM prompt
 * (app/api/onboarding/complete/route.ts), which is what actually lands in the
 * column; a hardcoded array of *display labels* in
 * components/pulse/PromptBankEditor.tsx; and nothing at all on the write path.
 * The editor's array shared no member with the stored values, so its sections
 * rendered empty and its add-row filed new prompts under a label nothing else
 * used.
 *
 * `prompt_bank.category` is plain nullable `text` with no CHECK
 * (002_phase2.sql:13), and its only writer is an LLM whose output is JSON.parsed
 * straight into an unnest. So live rows may hold arbitrary strings or NULL, and
 * the read path has to stay permissive even though the write path does not.
 */
export const PROMPT_CATEGORIES = [
  'brand_query',
  'category_query',
  'intent_query',
  'pain_point',
] as const

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]

export function isPromptCategory(value: unknown): value is PromptCategory {
  return typeof value === 'string' && (PROMPT_CATEGORIES as readonly string[]).includes(value)
}

/**
 * The next-intl key under the `pulse` namespace that labels a stored category.
 *
 * Anything outside the vocabulary — a legacy value, or NULL — resolves to
 * `cat_other` rather than being dropped, so existing rows stay visible and
 * editable. Named for the `sentiment_positive` / `sentiment_neutral` precedent
 * already in that namespace: `<domain>_<stored value>`.
 */
export function promptCategoryLabelKey(category: string | null | undefined): string {
  return isPromptCategory(category) ? `cat_${category}` : 'cat_other'
}
