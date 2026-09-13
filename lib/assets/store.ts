import 'server-only'
import { db } from '@/lib/db'
import type { QuestionDeclaration, RegisteredAsset } from '@/lib/view-models/asset-convergence'

/**
 * Registered pages and the questions an owner says they answer.
 *
 * Tenancy lives inside each statement rather than in a check before it: one
 * statement, no TOCTOU window, and zero rows means "absent or not yours"
 * without distinguishing the two. That is the shape the prompt-bank routes
 * already use, and the reason `authorizeAssetRegistry` deliberately carries no
 * ownership check of its own.
 *
 * `prompt_bank` predates tenancy — no `account_id`, and a plain FK to
 * `clients(id)` — so the database cannot prove a prompt belongs to this
 * account. `declareQuestion` proves it in SQL instead, by joining the prompt on
 * the asset's own `client_id`. That join is the entire tenancy guarantee for
 * the Pulse side of AC-06; removing it would let any authenticated owner attach
 * another account's question to their own page.
 *
 * Columns are named on every `returning`. `returning *` on a statement that
 * joins another table silently collapses duplicate column names — last wins —
 * so `row.id` would hold the joined table's id.
 */

export async function listAssets(accountId: string, clientId: string): Promise<RegisteredAsset[]> {
  const sql = db()
  const rows = await sql`
    select id, url, origin, label
    from client_assets
    where account_id = ${accountId} and client_id = ${clientId}
    order by label, id
  `
  return rows.map(row => ({
    id: String(row.id),
    url: String(row.url),
    origin: String(row.origin),
    label: String(row.label),
  }))
}

export async function listQuestionDeclarations(
  accountId: string,
  clientId: string,
): Promise<QuestionDeclaration[]> {
  const sql = db()
  const rows = await sql`
    select d.asset_id, d.prompt_id, p.question
    from client_asset_questions d
    join prompt_bank p on p.id = d.prompt_id
    where d.account_id = ${accountId} and d.client_id = ${clientId}
    order by d.asset_id, p.question, d.prompt_id
  `
  return rows.map(row => ({
    assetId: String(row.asset_id),
    promptId: String(row.prompt_id),
    question: String(row.question),
  }))
}

/**
 * Register a page, or update the label of one already registered.
 *
 * Returns `null` when the client does not exist or does not belong to this
 * account — the insert selects from `clients` with both predicates, so an
 * unowned client simply produces no row to insert.
 */
export async function registerAsset(input: {
  accountId: string
  clientId: string
  url: string
  origin: string
  label: string
  actorId: string
}): Promise<RegisteredAsset | null> {
  const sql = db()
  const rows = await sql`
    insert into client_assets (account_id, client_id, url, origin, label, created_by)
    select c.account_id, c.id, ${input.url}, ${input.origin}, ${input.label}, ${input.actorId}
    from clients c
    where c.id = ${input.clientId} and c.account_id = ${input.accountId}
    on conflict (account_id, client_id, url) do update
      set label = excluded.label, updated_at = now()
    returning id, url, origin, label
  `
  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    url: String(row.url),
    origin: String(row.origin),
    label: String(row.label),
  }
}

/**
 * Declare that a registered page answers a question.
 *
 * Both sides are constrained in the one statement: the asset by account and
 * client, and the prompt by the asset's own client_id. A prompt from another
 * account produces no row rather than a cross-tenant declaration.
 *
 * Returns false when nothing matched. A repeat declaration is not an error —
 * `on conflict do nothing` — but it returns no row, so the caller is told
 * whether this call is what created it.
 */
export async function declareQuestion(input: {
  accountId: string
  clientId: string
  assetId: string
  promptId: string
  actorId: string
}): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    insert into client_asset_questions (account_id, client_id, asset_id, prompt_id, declared_by)
    select a.account_id, a.client_id, a.id, p.id, ${input.actorId}
    from client_assets a
    join prompt_bank p on p.id = ${input.promptId} and p.client_id = a.client_id
    where a.id = ${input.assetId}
      and a.account_id = ${input.accountId}
      and a.client_id = ${input.clientId}
    on conflict (account_id, client_id, asset_id, prompt_id) do nothing
    returning id
  `
  return rows.length > 0
}

/** Withdraw a declaration. Zero rows means absent or not yours; the caller reports 404 either way. */
export async function withdrawQuestion(input: {
  accountId: string
  clientId: string
  assetId: string
  promptId: string
}): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    delete from client_asset_questions
    where account_id = ${input.accountId}
      and client_id = ${input.clientId}
      and asset_id = ${input.assetId}
      and prompt_id = ${input.promptId}
    returning id
  `
  return rows.length > 0
}
