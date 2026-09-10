import { createHash } from 'node:crypto'

/**
 * Approved reference content: the brand facts and FAQs a draft is allowed to cite.
 *
 * Everything here arrives from a customer paste or a CSV, so it is treated as
 * DATA throughout — never as instruction, never as markup. Two specific hazards
 * are handled at this boundary rather than at the point of use, because the point
 * of use is easy to forget:
 *
 *  - CSV formula injection. A cell beginning `=`, `+`, `-`, `@` or a control
 *    character is executed as a formula when the export is reopened in a
 *    spreadsheet. The value is preserved and prefixed with an apostrophe, which
 *    is the documented way to keep the text and drop the behaviour.
 *  - Instruction-shaped text. Deliberately NOT stripped: rewriting a customer's
 *    own facts would be worse than the risk. It is fenced where it reaches a
 *    prompt, and `agentUseAllowed` defaults to false so it cannot reach one by
 *    accident.
 */

export const SOURCE_KINDS = ['facts', 'faq'] as const
export const IMPORT_METHODS = ['paste', 'csv'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
export type ImportMethod = (typeof IMPORT_METHODS)[number]

export const MAX_ENTRIES = 200
export const MAX_FIELD = 4000
export const SOURCE_CONTENT_SCHEMA_VERSION = 1

export type SourceEntry = { question: string; answer: string }
export type SourceContent = { schemaVersion: 1; entries: SourceEntry[] }

export type SourceVersionDto = {
  id: string
  versionNumber: number
  contentHash: string
  importMethod: ImportMethod
  originRef: string | null
  importedAt: string
  approvedAt: string | null
  entries: SourceEntry[]
}

/**
 * `current` and `stale` are DERIVED, never stored. A stored freshness flag is
 * wrong the moment the clock moves past it and nothing would be there to correct
 * it, so the age is computed on read from the import time.
 */
export type FreshnessState = 'current' | 'stale'
export const STALE_AFTER_DAYS = 180

export type SourceDto = {
  id: string
  sourceKey: string
  kind: SourceKind
  label: string
  agentUseAllowed: boolean
  revokedAt: string | null
  latestVersion: number
  freshness: FreshnessState | null
  updatedAt: string
  current: SourceVersionDto | null
}

export class SourceInputError extends Error {
  constructor(readonly code: string) { super(code) }
}

function reject(code: string): never { throw new SourceInputError(code) }

/** Excel and Sheets treat these as the start of a formula, whoever opens the file. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/
// Control characters, minus the tab and newline a pasted answer may legitimately carry.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function sanitizeCell(value: string): string {
  // Unicode-normalise first: a composed and a decomposed form of the same text
  // would otherwise hash differently and read as two distinct facts.
  const normalized = value.normalize('NFC').replace(CONTROL, '').trim()
  return FORMULA_PREFIX.test(normalized) ? `'${normalized}` : normalized
}

function field(value: unknown, code: string): string {
  if (typeof value !== 'string') reject(code)
  const clean = sanitizeCell(value)
  if (!clean.length || clean.length > MAX_FIELD) reject(code)
  return clean
}

export function parseSourceEntries(value: unknown): SourceEntry[] {
  if (!Array.isArray(value) || value.length === 0) reject('SOURCE_ENTRIES_INVALID')
  if (value.length > MAX_ENTRIES) reject('SOURCE_ENTRIES_TOO_MANY')
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('SOURCE_ENTRIES_INVALID')
    const entry = raw as Record<string, unknown>
    return {
      question: field(entry.question, 'SOURCE_QUESTION_INVALID'),
      answer: field(entry.answer, 'SOURCE_ANSWER_INVALID'),
    }
  })
}

/**
 * Deliberately minimal: quoted fields with doubled quotes, and nothing else. A
 * permissive parser would be guessing at a customer's data, and guessing wrong
 * about which column holds the answer is worse than refusing the file.
 */
export function parseSourceCsv(text: string): SourceEntry[] {
  if (typeof text !== 'string' || !text.trim()) reject('SOURCE_CSV_EMPTY')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(cell); cell = ''; continue }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
      continue
    }
    cell += char
  }
  if (quoted) reject('SOURCE_CSV_UNTERMINATED_QUOTE')
  row.push(cell)
  rows.push(row)

  const usable = rows.filter(cells => cells.some(value => value.trim().length))
  if (!usable.length) reject('SOURCE_CSV_EMPTY')
  // Drop a header row only when it actually looks like one, so a file whose first
  // row is a real question is not silently discarded.
  const first = usable[0]!
  const looksLikeHeader = first.length >= 2
    && /^\s*(question|q|問題)\s*$/i.test(first[0] ?? '')
    && /^\s*(answer|a|答案|回答)\s*$/i.test(first[1] ?? '')
  const body = looksLikeHeader ? usable.slice(1) : usable
  if (!body.length) reject('SOURCE_CSV_EMPTY')
  return parseSourceEntries(body.map(cells => ({ question: cells[0] ?? '', answer: cells[1] ?? '' })))
}

export function buildSourceContent(entries: SourceEntry[]): SourceContent {
  return { schemaVersion: SOURCE_CONTENT_SCHEMA_VERSION, entries }
}

/**
 * Hashed over canonical content, so re-importing identical text yields the same
 * hash and can be recognised as no change rather than a new version.
 */
export function hashSourceContent(content: SourceContent): string {
  const canonical = JSON.stringify({
    schemaVersion: content.schemaVersion,
    entries: content.entries.map(entry => ({ question: entry.question, answer: entry.answer })),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function sourceFreshness(importedAt: string, now: Date): FreshnessState {
  const age = now.getTime() - Date.parse(importedAt)
  return age > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000 ? 'stale' : 'current'
}
