import { normalizeVerificationDomain } from '@/lib/domain-verification/schema'

/** The classifier's own cap (lib/pulse/analysis-fallback.ts slices to 10). */
export const MAX_COMPETITORS = 10
export const MAX_ALIASES = 5
export const MAX_DOMAINS = 5
export const MAX_NAME_LENGTH = 120

/** What the matcher needs about a competitor: its name and configured spellings. */
export type CompetitorRef = { name: string; aliases: string[] }

export type CompetitorInput = { name: string; aliases: string[]; domains: string[] }

export type CompetitorInputError =
  | 'invalid_body' | 'nothing_to_update' | 'name_required' | 'name_too_long'
  | 'invalid_aliases' | 'too_many_aliases' | 'invalid_domain' | 'too_many_domains'

type Parsed<T> = { ok: true; value: T } | { ok: false; error: CompetitorInputError }

const key = (value: string) => value.normalize('NFKC').toLowerCase()

function parseName(value: unknown): Parsed<string> {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) return { ok: false, error: 'name_required' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: 'name_too_long' }
  return { ok: true, value: name }
}

/** Trimmed, blank-free, case-insensitively unique, and never the name itself. */
function parseAliases(value: unknown, name: string | undefined): Parsed<string[]> {
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_aliases' }
  const seen = new Set(name ? [key(name)] : [])
  const aliases: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' || raw.trim().length > MAX_NAME_LENGTH) return { ok: false, error: 'invalid_aliases' }
    const alias = raw.trim()
    if (!alias || seen.has(key(alias))) continue
    seen.add(key(alias))
    aliases.push(alias)
  }
  if (aliases.length > MAX_ALIASES) return { ok: false, error: 'too_many_aliases' }
  return { ok: true, value: aliases }
}

/**
 * Registrable host only, lowercase, without `www.`. Uses domain verification's
 * normaliser, so address literals, dotless hosts and non-HTTP schemes are
 * refused the same way everywhere.
 */
function parseDomains(value: unknown): Parsed<string[]> {
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_domain' }
  const domains: string[] = []
  for (const raw of value) {
    const normalized = typeof raw === 'string' ? normalizeVerificationDomain(raw) : null
    if (!normalized) return { ok: false, error: 'invalid_domain' }
    const domain = normalized.replace(/^www\./, '')
    if (!domains.includes(domain)) domains.push(domain)
  }
  if (domains.length > MAX_DOMAINS) return { ok: false, error: 'too_many_domains' }
  return { ok: true, value: domains }
}

export function parseCompetitorInput(body: unknown): Parsed<CompetitorInput>
export function parseCompetitorInput(body: unknown, options: { partial: true }): Parsed<Partial<CompetitorInput>>
export function parseCompetitorInput(body: unknown, options?: { partial: true }): Parsed<Partial<CompetitorInput>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' }
  const input = body as Record<string, unknown>
  const partial = options?.partial === true
  const value: Partial<CompetitorInput> = {}

  if (!partial || input.name !== undefined) {
    const name = parseName(input.name)
    if (!name.ok) return name
    value.name = name.value
  }
  if (!partial || input.aliases !== undefined) {
    const aliases = parseAliases(input.aliases ?? [], value.name)
    if (!aliases.ok) return aliases
    value.aliases = aliases.value
  }
  if (!partial || input.domains !== undefined) {
    const domains = parseDomains(input.domains ?? [])
    if (!domains.ok) return domains
    value.domains = domains.value
  }
  if (partial && Object.keys(value).length === 0) return { ok: false, error: 'nothing_to_update' }
  return { ok: true, value }
}

/**
 * Table rows first (they carry aliases), then names that exist only in the
 * legacy `clients.competitors` array, once each case-insensitively, capped at
 * MAX_COMPETITORS. Onboarding and brand creation still write only the array,
 * so a reader that ignored it would miss every competitor added since 061.
 */
export function mergeCompetitorRefs(
  legacyNames: readonly unknown[] | null | undefined,
  rows: ReadonlyArray<{ name?: unknown; aliases?: unknown }>,
): CompetitorRef[] {
  const merged: CompetitorRef[] = []
  const seen = new Set<string>()
  const add = (name: unknown, aliases: unknown) => {
    if (typeof name !== 'string' || !name.trim() || seen.has(key(name.trim()))) return
    seen.add(key(name.trim()))
    merged.push({
      name: name.trim(),
      aliases: Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === 'string' && !!a.trim()) : [],
    })
  }
  for (const row of rows) add(row.name, row.aliases)
  for (const name of legacyNames ?? []) add(name, [])
  return merged.slice(0, MAX_COMPETITORS)
}
