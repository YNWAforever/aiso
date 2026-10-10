/**
 * Browser-side calls for the competitors editor. No server imports: this is
 * bundled into a client component.
 */

export type CompetitorView = {
  id: string | null
  name: string
  aliases: string[]
  domains: string[]
  created_at: string | null
  updated_at: string | null
}
export type CompetitorDraft = { name: string; aliases: string[]; domains: string[] }
export type CompetitorErrorKey =
  | 'err_name_required' | 'err_name_too_long' | 'err_invalid_aliases' | 'err_too_many_aliases'
  | 'err_invalid_domain' | 'err_too_many_domains' | 'err_exists' | 'err_limit'
  | 'err_signed_out' | 'err_generic'

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
type Result<T> = ({ ok: true } & T) | { ok: false; error: CompetitorErrorKey }

/** "a, b，c" or one per line, as people actually type a list. */
export function splitList(text: string): string[] {
  return text.split(/[,，\n]/).map(part => part.trim()).filter(Boolean)
}

const API_ERRORS: Record<string, CompetitorErrorKey> = {
  name_required: 'err_name_required',
  name_too_long: 'err_name_too_long',
  invalid_aliases: 'err_invalid_aliases',
  too_many_aliases: 'err_too_many_aliases',
  invalid_domain: 'err_invalid_domain',
  too_many_domains: 'err_too_many_domains',
  COMPETITOR_EXISTS: 'err_exists',
  COMPETITOR_LIMIT_REACHED: 'err_limit',
}

/** The message key for a failed response. Unknown codes fall back to generic, never to raw text. */
export function competitorErrorKey(status: number, body: unknown): CompetitorErrorKey {
  if (status === 401) return 'err_signed_out'
  const code = (body as { error?: unknown } | null)?.error
  return typeof code === 'string' && API_ERRORS[code] ? API_ERRORS[code] : 'err_generic'
}

const base = (clientId: string) => `/api/dashboard/clients/${encodeURIComponent(clientId)}/competitors`
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})

async function call(fetcher: Fetcher, url: string, init?: RequestInit): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetcher(url, init)
    return { status: res.status, body: await res.json().catch(() => null) }
  } catch {
    return null
  }
}

/**
 * An onboarding-only name has no row yet. Any write first copies such names
 * into the table, so its POST reports COMPETITOR_EXISTS while having created
 * exactly the row we want. Resolve that row's id by name.
 */
async function materialise(fetcher: Fetcher, clientId: string, name: string): Promise<Result<{ id: string }>> {
  const created = await call(fetcher, base(clientId), send('POST', { name }))
  if (!created) return { ok: false, error: 'err_generic' }
  const id = (created.body as { competitor?: { id?: unknown } } | null)?.competitor?.id
  if (created.status === 201 && typeof id === 'string') return { ok: true, id }
  if (created.status !== 409 || competitorErrorKey(409, created.body) !== 'err_exists') {
    return { ok: false, error: competitorErrorKey(created.status, created.body) }
  }
  const listed = await call(fetcher, base(clientId))
  const rows = (listed?.body as { competitors?: CompetitorView[] } | null)?.competitors ?? []
  const row = rows.find(r => r.id && r.name.toLowerCase() === name.toLowerCase())
  return row?.id ? { ok: true, id: row.id } : { ok: false, error: 'err_generic' }
}

export async function saveCompetitor(
  fetcher: Fetcher, clientId: string, id: string | null, draft: CompetitorDraft,
  options: { legacyName?: string } = {},
): Promise<Result<{ competitor: CompetitorView }>> {
  let target = id
  if (!target && options.legacyName) {
    const resolved = await materialise(fetcher, clientId, options.legacyName)
    if (!resolved.ok) return resolved
    target = resolved.id
  }
  const res = target
    ? await call(fetcher, `${base(clientId)}/${encodeURIComponent(target)}`, send('PATCH', draft))
    : await call(fetcher, base(clientId), send('POST', draft))
  if (!res) return { ok: false, error: 'err_generic' }
  const competitor = (res.body as { competitor?: CompetitorView } | null)?.competitor
  if ((res.status === 200 || res.status === 201) && competitor) return { ok: true, competitor }
  return { ok: false, error: competitorErrorKey(res.status, res.body) }
}

export async function removeCompetitor(
  fetcher: Fetcher, clientId: string, id: string | null, legacyName?: string,
): Promise<Result<object>> {
  let target = id
  if (!target) {
    if (!legacyName) return { ok: false, error: 'err_generic' }
    const resolved = await materialise(fetcher, clientId, legacyName)
    if (!resolved.ok) return resolved
    target = resolved.id
  }
  const res = await call(fetcher, `${base(clientId)}/${encodeURIComponent(target)}`, send('DELETE'))
  if (res && res.status === 200) return { ok: true }
  return { ok: false, error: res ? competitorErrorKey(res.status, res.body) : 'err_generic' }
}
