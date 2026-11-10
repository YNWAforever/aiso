import 'server-only'
import { loadStudioEvidence } from './evidence'
import { loadStudioOpportunities } from './opportunities'
import { buildStudioReceipts, type StudioReceipt } from './receipts'
import { composeSavedReply, STUDIO_PENDING_OPPORTUNITIES } from './reply'
import { HOME_TASKS, type StudioHomeTemplate } from './home'
import type { StudioOpportunities, StudioReply } from './types'

export type StudioComposeLanguage = 'en' | 'zh-HK'

export type ComposedStudioTurn = {
  reply: StudioReply
  receipts: StudioReceipt[]
}

/**
 * Compose one saved-evidence answer from account-scoped records on the server.
 *
 * The caller has already authorised (account, brand, profile); this function
 * only reads what that brand owns. Evidence is mandatory: without a readable
 * snapshot there is no answer to store, so it returns null and the route fails
 * closed rather than storing an unevidenced "success". Opportunities are read
 * only for the opportunity template — every other template would never use them.
 * The same pure composer the page uses runs here, so a stored reply and the
 * optimistic one the user saw cannot disagree about the records.
 */
export async function composeStudioTurn(input: {
  accountId: string
  clientId: string
  language: StudioComposeLanguage
  prompt: string
  task: StudioHomeTemplate | null
}): Promise<ComposedStudioTurn | null> {
  const evidence = await loadStudioEvidence(input.accountId, input.clientId)
  if (!evidence) return null
  let opportunities: StudioOpportunities | null = null
  if (input.task === 'opportunity') {
    try {
      opportunities = await loadStudioOpportunities(input.clientId, input.language)
    } catch {
      // A failed opportunity read stays pending; the reply says so instead of
      // pretending there were no suggestions.
      opportunities = null
    }
  }
  // The client composes with the task's capability, not its home label: `improve`
  // is a home task whose capability is a different StudioTemplate. Match that.
  const template = input.task ? HOME_TASKS[input.task].capability : null
  const reply = composeSavedReply(input.prompt, template, evidence, opportunities ?? STUDIO_PENDING_OPPORTUNITIES)
  return { reply, receipts: buildStudioReceipts({ evidence, reply, opportunities }) }
}
