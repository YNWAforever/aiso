import { authorizePromptBank } from '@/lib/prompts/guard'
import { isFeatureEnabled } from '@/lib/flags'
import { readDemandInputs } from '@/lib/prompts/demand-store'
import { demandDraftsCsv, draftDemandQuestions } from '@/lib/prompts/demand'
import { PULSE_ACTIVE_QUESTIONS_PER_BRAND } from '@/lib/pulse/limits'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'no-store' }

/**
 * Retainer OS Slice A: draft Pulse questions from the brand's own Hong Kong
 * search demand. Read-only — it returns drafts and their sources, and the
 * operator applies them through the existing bulk preview → apply path
 * (`…/prompts/bulk`). Gated like editing the bank (Pro/Enterprise, which is
 * also exactly who has Search Console); ownership is inside the store's query.
 * Without the Search Console flag or a current binding the answer is
 * `not_connected` (未連接), never an empty "no demand".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const access = await authorizePromptBank('write')
  if (!access.ok) return access.response
  const { clientId } = await params
  if (!UUID.test(clientId)) return Response.json({ error: 'Not found' }, { status: 404, headers })
  try {
    const input = await readDemandInputs(access.accountId, clientId)
    if (input.state === 'not_found') return Response.json({ error: 'Not found' }, { status: 404, headers })
    const budget = { activeCount: input.activeCount, activeLimit: PULSE_ACTIVE_QUESTIONS_PER_BRAND }
    if (!isFeatureEnabled('search_console') || input.state === 'not_connected') {
      return Response.json({ state: 'not_connected', ...budget }, { headers })
    }
    if (!input.queries.length) return Response.json({ state: 'no_data', window: input.window, ...budget }, { headers })
    const drafts = draftDemandQuestions({ queries: input.queries, brandName: input.brandName, domain: input.domain,
      existingQuestions: input.questions, activeSlots: PULSE_ACTIVE_QUESTIONS_PER_BRAND - input.activeCount })
    return Response.json({ state: 'ok', window: input.window, ...budget, excludedBranded: drafts.excludedBranded,
      rows: drafts.rows, sources: drafts.sources, csv: drafts.rows.length ? demandDraftsCsv(drafts.rows) : '' }, { headers })
  } catch {
    // A lookup failure must not read as "not connected" or "no demand".
    return Response.json({ error: 'DEMAND_UNAVAILABLE' }, { status: 503, headers })
  }
}
