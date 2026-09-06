export type EntityDto = {
  clientId: string
  displayName: string
  aliases: string[]
  revision: number
  verification: 'unverified'
  updatedAt: string
}

export type EntityInput = { displayName: string; aliases: string[]; expectedRevision: number }
export const ENTITY_BODY_LIMIT = 16 * 1024

function label(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_ENTITY_INPUT')
  const normalized = value.trim().normalize('NFC')
  if (!normalized || [...normalized].length > 120 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(normalized)) {
    throw new Error('INVALID_ENTITY_INPUT')
  }
  return normalized
}

export function normalizeEntityInput(value: unknown): EntityInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_ENTITY_INPUT')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 3 || !['displayName', 'aliases', 'expectedRevision'].every(key => Object.hasOwn(input, key))) throw new Error('INVALID_ENTITY_INPUT')
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0 || (input.expectedRevision as number) > 2147483646) throw new Error('INVALID_ENTITY_INPUT')
  if (!Array.isArray(input.aliases) || input.aliases.length > 20) throw new Error('INVALID_ENTITY_INPUT')
  const displayName = label(input.displayName)
  const seen = new Set([displayName.toLowerCase()])
  const aliases = input.aliases.map(label).filter(alias => {
    const key = alias.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {displayName, aliases, expectedRevision: input.expectedRevision as number}
}
