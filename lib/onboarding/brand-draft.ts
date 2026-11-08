import type { IndustryCode } from '@/lib/types'
import type { PromptLanguage } from '@/lib/prompts/context'
/** The member can add more by hand; a suggestion list longer than this is noise. */
export const MAX_SUGGESTED_COMPETITORS = 5
/** Browser-safe contract. A suggestion is not an approved source or a saved brand. */
export type BrandDraftEvidence = { field: 'brandName' | 'description' | 'industry'; quote: string }
/**
 * A competitor the model proposed. Never evidence: the member confirms each one,
 * and the domain is only a proposal until the browser's live check resolves it.
 */
export type BrandDraftCompetitor = { name: string; domain: string | null }
export type BrandDraft = {
  brandName: string; domain: string; description: string; industry: IndustryCode | null;
  evidence?: BrandDraftEvidence[]; competitors?: BrandDraftCompetitor[]; reviewRequired?: boolean;
  language: PromptLanguage; market: string; sourceUrl: string; fetchedAt: string;
}
