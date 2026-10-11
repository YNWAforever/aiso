import type { IndustryCode } from '@/lib/types'
import type { PromptLanguage } from '@/lib/prompts/context'
/** Browser-safe contract. A suggestion is not an approved source or a saved brand. */
export type BrandDraft = {
  brandName: string; domain: string; description: string; industry: IndustryCode | null;
  language: PromptLanguage; market: string; sourceUrl: string; fetchedAt: string;
}
