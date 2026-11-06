/**
 * Site-edit S1 (post–Stage 6, option E executor hand-off): a structured,
 * reviewable edit spec carried inside a work-item draft and frozen into its
 * C9d review version, so approval covers exactly what an executor will apply.
 * Browser-safe and pure: the editor and the server share this contract.
 *
 * S1 had one kind, one JSON-LD block on one page; S9 adds `meta` (the page's
 * title and/or meta description) and S10 `llms_txt` (the domain's /llms.txt). Nothing here contacts a site; the brand-domain check needs the database and lives with
 * the callers (draft save, version submit).
 */

export const EDIT_SPEC_SCHEMA_TYPES = ['FAQPage', 'Organization', 'LocalBusiness'] as const
export type EditSpecSchemaType = typeof EDIT_SPEC_SCHEMA_TYPES[number]

/**
 * `jsonld` adds one block. `jsonld_remove` (S5) is a revert: it removes a block
 * equal to `payload`, and is only accepted when an earlier APPROVED version of
 * the same work item added exactly that block (checked server-side). There is
 * no silent rollback: a revert is reviewed, approved and handed off like an add.
 */
export const EDIT_SPEC_KINDS = ['jsonld', 'jsonld_remove', 'meta', 'llms_txt'] as const
export type EditSpecKind = typeof EDIT_SPEC_KINDS[number]

export type JsonLdEditSpec = {
  schemaVersion: 1
  kind: 'jsonld' | 'jsonld_remove'
  targetUrl: string
  schemaType: EditSpecSchemaType
  payload: Record<string, unknown>
}

/**
 * S9: set the page's `<title>` and/or `<meta name="description">`. A null
 * field is left as it is on the page; at least one is set. There is no
 * separate revert kind: undoing is another reviewed `meta` edit with the
 * previous text.
 */
export type MetaEditSpec = {
  schemaVersion: 1
  kind: 'meta'
  targetUrl: string
  title: string | null
  description: string | null
}

/**
 * S10: replace the domain's `/llms.txt` with `content`. The target is always
 * the root file (`https://<host>/llms.txt`, no query). Line endings are stored
 * as LF. Like `meta`, undoing is another reviewed edit with the old text.
 */
export type LlmsTxtEditSpec = {
  schemaVersion: 1
  kind: 'llms_txt'
  targetUrl: string
  content: string
}

export type EditSpecV1 = JsonLdEditSpec | MetaEditSpec | LlmsTxtEditSpec

/** Bytes (UTF-8) of llms.txt content; the whole spec stays inside 095's 20 KiB floor. */
export const EDIT_SPEC_LLMS_TXT_MAX_BYTES = 16 * 1024

export const EDIT_SPEC_TITLE_MAX = 200
export const EDIT_SPEC_DESCRIPTION_MAX = 500

export const EDIT_SPEC_URL_MAX = 2048
/** Serialized payload bound; the whole spec also fits 042's 128 KiB version cap with room to spare. */
export const EDIT_SPEC_PAYLOAD_MAX_BYTES = 16 * 1024
export const EDIT_SPEC_MAX_DEPTH = 8
export const EDIT_SPEC_MAX_NODES = 500

export class EditSpecError extends Error {
  constructor(readonly code: 'shape' | 'url' | 'type' | 'payload' | 'size' | 'markup' | 'meta' | 'llms') {
    super(`INVALID_EDIT_SPEC:${code}`)
    this.name = 'EditSpecError'
  }
}

const fail = (code: EditSpecError['code']): never => { throw new EditSpecError(code) }

function record(value: unknown, code: EditSpecError['code']): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
  return value as Record<string, unknown>
}

/**
 * JSON-LD is embedded by the executor inside a <script> element. A string that
 * closes the element or opens an HTML comment could break out of it, so those
 * sequences are refused here rather than trusted to every executor's escaping.
 */
const MARKUP_BREAKOUT = /<\/script|<!--/i

/**
 * Characters Postgres jsonb refuses (U+0000, lone surrogates) plus the other
 * controls the draft text fields already refuse (lib/work-items/edit-input.ts).
 * Tab, LF and CR stay allowed. Refusing them here makes a bad payload a 400,
 * not a database error surfacing as 503.
 */
const FORBIDDEN_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u

function safeText(value: string): string {
  if (MARKUP_BREAKOUT.test(value)) fail('markup')
  if (FORBIDDEN_CHARS.test(value)) fail('payload')
  return value
}

/** Deep copy with object keys sorted, so equal specs serialize (and hash) identically. */
function canonicalPayload(value: unknown, depth: number, budget: { nodes: number }): unknown {
  if (--budget.nodes < 0) fail('size')
  if (depth > EDIT_SPEC_MAX_DEPTH) fail('payload')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : fail('payload')
  if (typeof value === 'string') return safeText(value).normalize('NFC')
  if (Array.isArray(value)) return value.map(item => canonicalPayload(item, depth + 1, budget))
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => {
        return [safeText(key), canonicalPayload(entry, depth + 1, budget)] as const
      })
    return Object.fromEntries(entries)
  }
  return fail('payload')
}

function parseTargetUrl(value: unknown): string {
  if (typeof value !== 'string') return fail('url')
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > EDIT_SPEC_URL_MAX) fail('url')
  let url: URL
  try { url = new URL(trimmed) } catch { return fail('url') }
  // https only: an edit lands on a public page the existing scan can re-fetch.
  // `url.hash` is '' for a bare trailing '#', yet href keeps it; '#' can only
  // appear unencoded in href as the fragment delimiter.
  if (url.protocol !== 'https:' || url.username || url.password || url.href.includes('#') || url.port) fail('url')
  if (!url.hostname.includes('.')) fail('url')
  return url.href
}

/**
 * One line of page text: trimmed, NFC, no controls (tab and newlines included:
 * a title or description is a single line), and no `<` or `>`, so it cannot
 * open or close markup whatever the executor's escaping does. Null or an
 * empty string means "leave this field as it is".
 */
function metaText(value: unknown, max: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return fail('meta')
  const text = value.trim().normalize('NFC')
  if (!text) return null
  if (/[<>]/.test(text)) fail('markup')
  if (/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(text) || [...text].length > max) fail('meta')
  return text
}

function parseMetaSpec(input: Record<string, unknown>, targetUrl: string): MetaEditSpec {
  const keys = ['schemaVersion', 'kind', 'targetUrl', 'title', 'description']
  if (Object.keys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) fail('shape')
  const title = metaText(input.title, EDIT_SPEC_TITLE_MAX)
  const description = metaText(input.description, EDIT_SPEC_DESCRIPTION_MAX)
  if (title === null && description === null) fail('meta')
  return { schemaVersion: 1, kind: 'meta', targetUrl, title, description }
}

/**
 * The file's text as approved: LF line endings, NFC, no controls other than tab
 * and newline, not blank, and at most 16 KiB. Markup is allowed: llms.txt is
 * served as plain text (it is Markdown by convention), never inside a page.
 */
export function normalizeLlmsTxt(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}

function parseLlmsTxtSpec(input: Record<string, unknown>, targetUrl: string): LlmsTxtEditSpec {
  const keys = ['schemaVersion', 'kind', 'targetUrl', 'content']
  if (Object.keys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) fail('shape')
  const url = new URL(targetUrl)
  if (url.pathname !== '/llms.txt' || url.search) fail('url')
  if (typeof input.content !== 'string') return fail('llms')
  const content = normalizeLlmsTxt(input.content)
  if (!content.trim() || /[\u0000-\u0008\u000b-\u001f\u007f\uD800-\uDFFF]/u.test(content)) fail('llms')
  if (new TextEncoder().encode(content).byteLength > EDIT_SPEC_LLMS_TXT_MAX_BYTES) fail('size')
  return { schemaVersion: 1, kind: 'llms_txt', targetUrl, content }
}

/**
 * Strict parse of an edit spec. Unknown keys, a mismatched `@type`, a non-
 * schema.org `@context`, an oversized or over-deep payload, or a non-https URL
 * are refused. The result is canonical: re-parsing it returns an equal value.
 */
export function parseEditSpec(value: unknown): EditSpecV1 {
  const input = record(value, 'shape')
  if (input.schemaVersion !== 1 || !(EDIT_SPEC_KINDS as readonly unknown[]).includes(input.kind)) fail('shape')
  if (input.kind === 'meta') return parseMetaSpec(input, parseTargetUrl(input.targetUrl))
  if (input.kind === 'llms_txt') return parseLlmsTxtSpec(input, parseTargetUrl(input.targetUrl))
  const keys = ['schemaVersion', 'kind', 'targetUrl', 'schemaType', 'payload']
  if (Object.keys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) fail('shape')
  const kind = input.kind as JsonLdEditSpec['kind']
  const targetUrl = parseTargetUrl(input.targetUrl)
  if (typeof input.schemaType !== 'string' || !(EDIT_SPEC_SCHEMA_TYPES as readonly string[]).includes(input.schemaType)) fail('type')
  const schemaType = input.schemaType as EditSpecSchemaType

  const raw = record(input.payload, 'payload')
  const context = raw['@context']
  if (context !== 'https://schema.org' && context !== 'https://schema.org/') fail('payload')
  if (raw['@type'] !== schemaType) fail('type')
  const payload = canonicalPayload(raw, 0, { nodes: EDIT_SPEC_MAX_NODES }) as Record<string, unknown>
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > EDIT_SPEC_PAYLOAD_MAX_BYTES) fail('size')

  return { schemaVersion: 1, kind, targetUrl, schemaType, payload }
}
