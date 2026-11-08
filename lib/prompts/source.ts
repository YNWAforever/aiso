/**
 * Where a monitored question came from. Stored, never inferred: NULL means the
 * provenance was not recorded (every row written before migration 100, or a
 * question the operator typed themselves).
 *
 * Client-safe: the prompt editor renders these labels.
 */
export const PROMPT_SOURCES = ['profile', 'demand'] as const
export type PromptSource = typeof PROMPT_SOURCES[number]

export function isPromptSource(value: unknown): value is PromptSource {
  return typeof value === 'string' && (PROMPT_SOURCES as readonly string[]).includes(value)
}
