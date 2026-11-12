import type { PlanFeatures } from '@/lib/plans/catalog'
import type { StudioHomeTemplate } from './home'
import type { StudioMcpToolName } from './mcp/registry'

/**
 * The server-owned skill registry (approved SME copilot redesign, slice 3).
 *
 * A skill is a named one-tap job that produces a saved Studio turn — never a
 * hidden request. Slice 3 formalises the six existing home tasks and declares
 * the read-only MCP tools each one uses, so an external read-only assistant and
 * the in-product cards describe the same capability. Action skills
 * (`scan_brand`, `improve_page`, `monthly_report`) keep their ids here but only
 * become runnable in slice 4, behind an inline confirm and their plan gate; no
 * write path is invented in slice 3.
 *
 * Copy lives in `messages/*.json` (`conversationStudio.skills.<id>.*`) rather than
 * inline bilingual strings: that is this repository's i18n convention, and it
 * keeps every user-visible string in the catalogue that parity tests check.
 */
export const STUDIO_SKILL_IDS = [
  'visibility_now', 'what_ai_says', 'top_opportunity', 'improve_page',
  'compare_competitors', 'draft_brief', 'monthly_report', 'scan_brand', 'explain_drop',
] as const

export type StudioSkillId = typeof STUDIO_SKILL_IDS[number]
export type StudioSkillCategory = 'discover' | 'improve' | 'deliver'
export type StudioSkillRun = 'context-only' | 'compose' | 'action'

export interface StudioSkill {
  id: StudioSkillId
  category: StudioSkillCategory
  /** What a v1 tap does. Action skills stay `action` until slice 4 wires the confirm. */
  runs: StudioSkillRun
  /** The existing Studio home task this skill formalises, when it has one. */
  task: StudioHomeTemplate | null
  /** Read-only context the skill promises up front; the same tools the MCP exposes. */
  tools: readonly StudioMcpToolName[]
  planFeature?: keyof PlanFeatures
  /** Where the saved turn can be continued, when the skill points at another destination. */
  destination?: 'improve' | 'reports' | 'chat'
}

export const STUDIO_SKILLS: readonly StudioSkill[] = [
  { id: 'visibility_now', category: 'discover', runs: 'context-only', task: 'pulse', tools: ['brand_evidence'] },
  { id: 'what_ai_says', category: 'discover', runs: 'context-only', task: null, tools: ['brand_evidence', 'brand_sources'] },
  { id: 'top_opportunity', category: 'discover', runs: 'context-only', task: 'opportunity', tools: ['scan_checks', 'content_opportunities'], destination: 'improve' },
  { id: 'improve_page', category: 'improve', runs: 'context-only', task: 'improve', tools: ['scan_checks', 'content_opportunities', 'brand_sources'], destination: 'improve' },
  { id: 'compare_competitors', category: 'discover', runs: 'context-only', task: 'competitors', tools: ['brand_evidence'] },
  { id: 'draft_brief', category: 'deliver', runs: 'context-only', task: 'brief', tools: ['content_opportunities', 'brand_sources'] },
  { id: 'monthly_report', category: 'deliver', runs: 'context-only', task: 'report', tools: ['brand_evidence', 'scan_checks', 'work_item_drafts', 'search_console_status'], destination: 'reports' },
  { id: 'scan_brand', category: 'improve', runs: 'action', task: null, tools: ['scan_checks'], destination: 'improve' },
  { id: 'explain_drop', category: 'discover', runs: 'context-only', task: null, tools: ['brand_evidence'] },
]

export function studioSkill(id: string | null | undefined): StudioSkill | null {
  return STUDIO_SKILLS.find(skill => skill.id === id) ?? null
}

export function isStudioSkillId(value: unknown): value is StudioSkillId {
  return typeof value === 'string' && (STUDIO_SKILL_IDS as readonly string[]).includes(value)
}

/** Persisted thread skill. Unknown/absent values stay null rather than guessed. */
export function parseStudioSkill(value: unknown): StudioSkillId | null {
  return isStudioSkillId(value) ? value : null
}

/** The six context skills that have a home card in v1, in registry order. */
export const STUDIO_CARD_SKILLS: readonly StudioSkill[] = STUDIO_SKILLS.filter(skill => skill.task !== null && skill.runs === 'context-only')

export function skillForTask(task: StudioHomeTemplate | null | undefined): StudioSkillId | null {
  if (!task) return null
  return STUDIO_SKILLS.find(skill => skill.task === task)?.id ?? null
}

/**
 * A thread's skill: the persisted column when present, otherwise the first
 * turn's task (the pre-slice-3 derivation, kept so old threads stay grouped).
 */
export function skillForThread(input: { skill?: unknown; firstTask?: unknown }): StudioSkillId | null {
  return parseStudioSkill(input.skill) ?? skillForTask(typeof input.firstTask === 'string' ? input.firstTask as StudioHomeTemplate : null)
}
