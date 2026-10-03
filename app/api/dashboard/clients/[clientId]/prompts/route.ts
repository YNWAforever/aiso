import { db } from '@/lib/db'
import { isPromptCategory } from '@/lib/prompts/categories'
import { authorizePromptBank } from '@/lib/prompts/guard'
import { MAX_PROMPTS } from '@/lib/pulse/limits'
import { parsePromptContext } from '@/lib/prompts/context'

export const dynamic = 'force-dynamic'

// `text` is unbounded, so without a cap an oversized body becomes a stored
// megabyte that every subsequent read and every weekly LLM prompt carries.
const MAX_QUESTION_LENGTH = 500

// Columns are named rather than `*` on every statement in this feature. See the
// note in [promptId]/route.ts — on a statement that joins clients it is not a
// style preference, it is a correctness requirement.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const access = await authorizePromptBank('read')
  if (!access.ok) return access.response

  const sql = db()
  try {
    const owned = await sql`
      select id from clients
      where id = ${clientId} and account_id = ${access.accountId}
      limit 1
    `
    if (owned.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })

    // The `id` tiebreak is load-bearing: created_at is transaction time, so all
    // 24 rows an onboarding writes share one value and intra-category order
    // would otherwise vary between requests.
    const prompts = await sql`
      select p.id, p.client_id, p.category, p.question, p.language, p.market, p.is_active, p.created_at
      from prompt_bank p join clients c on c.id = p.client_id
      where p.client_id = ${clientId} and c.account_id = ${access.accountId}
      order by p.category, p.created_at, p.id
    `
    return Response.json({ prompts })
  } catch {
    // Never let a failed lookup read as "not yours" — that would deny a
    // legitimate owner during a database incident.
    return Response.json({ error: 'Prompt lookup failed' }, { status: 503 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const access = await authorizePromptBank('write')
  if (!access.ok) return access.response

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad body')
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Validated against the vocabulary rather than accepted as free text. The
  // column has no CHECK, and the editor's own add-row used to send a display
  // label ('Brand Queries'), so without this the first thing POST writes in
  // production is a category nothing else matches.
  if (!isPromptCategory(body.category)) {
    return Response.json({ error: 'Invalid category' }, { status: 400 })
  }
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return Response.json({ error: 'question required' }, { status: 400 })
  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json({ error: 'question too long' }, { status: 400 })
  }
  // Validate provided fields before a lookup. Missing language is resolved only
  // from an explicitly saved brand default, never from request/UI locale.
  try { parsePromptContext({ language: body.language === undefined ? 'en' : body.language, market: body.market }) }
  catch { return Response.json({ error: 'Invalid prompt context' }, { status: 400 }) }

  const sql = db()
  try {
    // Ownership and capacity in one round trip. The capacity number is advisory
    // — two concurrent adds can overshoot by one, which is harmless — but the
    // ownership predicate below is authoritative.
    const owned = await sql`
      select c.id, c.region,
             (select draft->>'language' from onboarding_progress op where op.client_id = c.id and op.account_id = c.account_id) as prompt_language,
             (select count(*)::int from prompt_bank b where b.client_id = c.id) as prompt_count
      from clients c
      where c.id = ${clientId} and c.account_id = ${access.accountId}
      limit 1
    `
    const row = owned[0] as { prompt_count: number; prompt_language?: unknown; region?: unknown } | undefined
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
    let context
    try { context = parsePromptContext(body, { language: row.prompt_language, market: row.region }) }
    catch { return Response.json({ error: 'Prompt language must be confirmed' }, { status: 400 }) }
    if (row.prompt_count >= MAX_PROMPTS) {
      // Refused rather than accepted-and-ignored: past this the weekly run
      // silently scans an arbitrary subset, so a 201 here would be a lie.
      return Response.json(
        { error: 'PROMPT_LIMIT_REACHED', max: MAX_PROMPTS },
        { status: 409 },
      )
    }

    // The tenancy predicate is re-asserted inside the write, so the decision
    // that matters is never TOCTOU. client_id comes from the path, never the
    // body.
    const inserted = await sql`
      insert into prompt_bank (client_id, category, question, language, market, is_active)
      select c.id, ${body.category}::text, ${question}::text, ${context.language}::text, ${context.market}::text, true
      from clients c
      where c.id = ${clientId} and c.account_id = ${access.accountId}
      returning id, client_id, category, question, language, market, is_active, created_at
    `
    if (!inserted[0]) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ prompt: inserted[0] }, { status: 201 })
  } catch {
    // A 2xx must mean the write happened.
    return Response.json({ error: 'Prompt create failed' }, { status: 500 })
  }
}
