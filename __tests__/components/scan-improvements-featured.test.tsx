import { beforeEach, expect, it, vi } from 'vitest'
import { ScanImprovements } from '@/components/dashboard/ScanImprovements'
import { ResultPriorityCard } from '@/components/dashboard/ResultPriorityCard'
import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { manyCandidates, clientId } from './c9c-fixtures'
const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/opportunities/service', () => ({ loadAuthenticatedOpportunities: load }))
beforeEach(() => { load.mockReset(); load.mockResolvedValue(manyCandidates) })
it('loads the existing owner-guarded scan projection and sends only the first eligible finding to Results', async () => {
  const scanId = manyCandidates.window.scanId!
  const element = await ScanImprovements({ clientId, scanId, featured: true, brandName: 'Synthetic brand' })
  expect(load).toHaveBeenCalledWith(clientId, new URLSearchParams({ scanId }))
  expect(element.type).toBe(ResultPriorityCard)
  expect(element.props.initial.suggestion.key).toBe(manyCandidates.suggestions[0].key)
  expect(element.props.initial).not.toHaveProperty('suggestions')
  expect(element.props).toMatchObject({ clientId, scanId, brandName: 'Synthetic brand' })
})
it('keeps Improve and an unavailable Results projection distinct', async () => {
  expect((await ScanImprovements({ clientId, scanId: manyCandidates.window.scanId! })).type).toBe(OpportunityWorkspace)
  load.mockRejectedValue(new Error('Synthetic read failure'))
  const element = await ScanImprovements({ clientId, scanId: manyCandidates.window.scanId!, featured: true })
  expect(element.props.initial).toEqual({ suggestion: null, unavailable: true })
})
