import { NextRequest, NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { callOpenRouter } from '@/lib/openrouter'
import { isPromptCategory, PROMPT_CATEGORIES } from '@/lib/prompts/categories'
import { authorizePromptBank } from '@/lib/prompts/guard'

export const dynamic = 'force-dynamic'

const MAX_SUGGESTIONS = 10
const EXISTING_SAMPLE = 50

/**
 * Suggests new questions for a brand's bank, deduped against what it already has.
 *
 * Not redundant with onboarding/complete, which seeds the bank once at brand
 * creation and skips generation entirely on a resumed onboarding. This is the
 * incremental generator: it feeds the existing questions back into the prompt as
 * "do NOT repeat these", is bounded to 1-10, and returns candidates for review
 * rather than writing them.
 *
 * Gated on `edit_prompts` — which it never was. Pre-fence this was auth-only, so
 * any signed-in free user could spend OpenRouter budget on it, and a suggestion
 * is worthless without the write endpoint, which requires the same flag. The
 * gate runs before the ownership lookup so an unentitled caller cannot probe
 * which client ids exist, and before any LLM call so a refusal is free.
 */
export async function POST(req: NextRequest) {
  const access = await authorizePromptBank('write')
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const clientId = (body as { clientId?: unknown }).clientId
  if (typeof clientId !== 'string' || !clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  const rawCount = Number((body as { count?: unknown }).count)
  const count = Number.isFinite(rawCount)
    ? Math.min(Math.max(1, Math.trunc(rawCount)), MAX_SUGGESTIONS)
    : 5

  const sql = db()
  let brandName = ''
  let industry: string | null = null
  let existingList = ''
  try {
    const rows = await sql`
      select brand_name, industry from clients
      where id = ${clientId} and account_id = ${access.accountId}
      limit 1
    `
    const client = rows[0] as { brand_name: string; industry: string | null } | undefined
    // 404, not 403 — the id came from the caller, so confirming it exists would
    // tell them it belongs to somebody.
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    brandName = client.brand_name
    industry = client.industry

    const existing = await sql`
      select question from prompt_bank
      where client_id = ${clientId}
      order by created_at, id
      limit ${EXISTING_SAMPLE}
    `
    existingList = (existing as unknown as Array<{ question: string }>)
      .map(p => `- ${p.question}`).join('\n')
  } catch {
    // Never let a failed lookup read as "not yours". The pre-fence version
    // caught this and returned false, so a database incident became a 404.
    return NextResponse.json({ error: 'Client lookup failed' }, { status: 503 })
  }

  const raw = await callOpenRouter({
    model: 'openai/gpt-4o-mini',
    maxTokens: 800,
    messages: [{
      role: 'user',
      content: `Brand: ${brandName}\nIndustry: ${industry ?? 'general'}\n\n`
        + `Existing questions (do NOT repeat these):\n${existingList || '(none yet)'}\n\n`
        + `Generate ${count} NEW, diverse questions for tracking this brand's AI visibility. `
        + `Mix categories: ${PROMPT_CATEGORIES.join(', ')}.\n\n`
        + `Return ONLY a JSON array: [{"question":"...","category":"brand_query"}]`,
    }],
  }).catch(() => '[]')

  let parsed: unknown = []
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    parsed = JSON.parse(match?.[0] ?? raw)
  } catch { /* an unparseable reply is an empty list, not a 500 */ }

  // Filtered against the vocabulary here, not only at write time, so a model
  // that invents a category yields fewer suggestions rather than one the user
  // can accept and then be 400'd on.
  const suggestions = (Array.isArray(parsed) ? parsed : [])
    .filter((s): s is { question: string; category: string } =>
      Boolean(s) && typeof s === 'object'
      && typeof (s as { question?: unknown }).question === 'string'
      && (s as { question: string }).question.trim().length > 0
      && isPromptCategory((s as { category?: unknown }).category))
    .map(s => ({ question: s.question.trim(), category: s.category }))
    .slice(0, count)

  return NextResponse.json({ suggestions })
}
