import { db } from '@/lib/db'
import { authorizePromptBank } from '@/lib/prompts/guard'

export const dynamic = 'force-dynamic'

const MAX_QUESTION_LENGTH = 500

/**
 * Both handlers put tenancy inside the write statement rather than checking it
 * first. `prompt_bank` has no `account_id`, so ownership has to traverse
 * `prompt_bank.client_id → clients.account_id`; doing that as a separate query
 * would leave a window between the check and the write. Here there is none.
 *
 * `p.client_id = ${clientId}` **and** `c.id = p.client_id` together are what make
 * the URL's clientId load-bearing — a prompt is only addressable under its own
 * client's path. Zero rows covers all three misses (prompt absent, prompt under
 * a different client, client under a different account) without distinguishing
 * them, which is the contract: the id came from the caller, so 404, never 403.
 *
 * **Never `returning *` on these.** `prompt_bank` and `clients` both have `id`
 * and `created_at`. The Neon HTTP driver builds each row with
 * `Object.fromEntries(...)`, so duplicate column names silently overwrite —
 * last wins — and the joined relation's columns come after the target's. A bare
 * `returning *` would hand the client back `prompt.id = <clientId>`, and the
 * next PATCH or DELETE would then 404 against an id that never existed. It
 * typechecks, it looks right in review, and it is wrong.
 */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string; promptId: string }> },
) {
  const { clientId, promptId } = await params
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

  // Only these two are patchable. category, client_id and id are not — a prompt
  // cannot be moved between brands or recategorised through this route.
  const question = typeof body.question === 'string' ? body.question.trim() : null
  const isActive = typeof body.is_active === 'boolean' ? body.is_active : null

  if (question === null && isActive === null) {
    // Checked here rather than in SQL: `where $1 is not null` is exactly the
    // shape that produces "could not determine data type of parameter", and it
    // would turn a bad request into a 404.
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }
  if (question !== null && !question) {
    return Response.json({ error: 'question cannot be blank' }, { status: 400 })
  }
  if (question !== null && question.length > MAX_QUESTION_LENGTH) {
    return Response.json({ error: 'question too long' }, { status: 400 })
  }

  const sql = db()
  try {
    // The casts are not strictly required — coalesce infers each parameter's
    // type from its typed sibling — but they match the repo's idiom, they make
    // the inference error structurally impossible under later edits, and they
    // document that null means "absent" rather than "set to null".
    const updated = await sql`
      update prompt_bank p
         set question  = coalesce(${question}::text, p.question),
             is_active = coalesce(${isActive}::boolean, p.is_active)
        from clients c
       where p.id = ${promptId}
         and p.client_id = ${clientId}
         and c.id = p.client_id
         and c.account_id = ${access.accountId}
      returning p.id, p.client_id, p.category, p.question,
                p.language, p.is_active, p.created_at
    `
    if (!updated[0]) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ prompt: updated[0] })
  } catch {
    return Response.json({ error: 'Prompt update failed' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ clientId: string; promptId: string }> },
) {
  const { clientId, promptId } = await params
  const access = await authorizePromptBank('write')
  if (!access.ok) return access.response

  const sql = db()
  try {
    const deleted = await sql`
      delete from prompt_bank p
       using clients c
       where p.id = ${promptId}
         and p.client_id = ${clientId}
         and c.id = p.client_id
         and c.account_id = ${access.accountId}
      returning p.id
    `
    if (!deleted[0]) return Response.json({ error: 'Not found' }, { status: 404 })
    return new Response(null, { status: 204 })
  } catch {
    return Response.json({ error: 'Prompt delete failed' }, { status: 500 })
  }
}
