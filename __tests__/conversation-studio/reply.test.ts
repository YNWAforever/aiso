import { expect, it } from 'vitest'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { emptyStudioEvidence, savedStudioEvidence, savedStudioScan } from '@/__tests__/helpers/studio-evidence'

it.each(['brief', 'pulse', 'competitors', 'report', null] as const)('is explicitly insufficient without saved evidence (%s)', template => {
  const reply = composeSavedReply('bakery', template, emptyStudioEvidence)
  expect(reply.status).toBe('insufficient')
  expect(reply.observations).toEqual([])
  expect(reply.coverage).toMatchObject({ pulse: 'missing', citations: 'missing', scan: 'missing', live: 'unsupported' })
})
it.each(['brief', 'pulse', 'report'] as const)('composes %s from saved observations with original sources only', template => {
  const reply = composeSavedReply('anything', template, savedStudioEvidence)
  expect(reply.status).toBe('evidenced')
  expect(reply.observations).toEqual(savedStudioEvidence.observations)
  expect(reply.coverage).toMatchObject({ pulse: 'present', citations: 'present', scan: 'missing', live: 'unsupported' })
})
it('never treats keyword matches or saved model output as a verified answer to a freeform question', () => {
  const reply = composeSavedReply('Is sourdough gluten free today?', null, savedStudioEvidence)
  expect(reply.status).toBe('insufficient')
  expect(reply.observations).toHaveLength(1)
  expect(composeSavedReply('unrelated helicopters', null, savedStudioEvidence).observations).toEqual([])
  expect(composeSavedReply('what is it?', null, savedStudioEvidence).observations).toEqual([])
})
it('does not infer competitor rankings, live mentions or market coverage from saved records', () => {
  expect(composeSavedReply('compare', 'competitors', savedStudioEvidence).status).toBe('insufficient')
  expect(composeSavedReply('GSC HK mentions today', null, savedStudioEvidence).status).toBe('insufficient')
})
it('does not count incomplete observations or plain text links as supporting citations', () => {
  const data = structuredClone(savedStudioEvidence)
  data.observations[0].result = 'incomplete'
  data.observations[0].brandMentioned = null
  data.observations[0].links[0].kind = 'text-link'
  const reply = composeSavedReply('pulse', 'pulse', data)
  expect(reply.status).toBe('insufficient')
  expect(reply.coverage.citations).toBe('missing')
})
it('summarises saved scan checks without using them to claim Pulse coverage', () => {
  const data = { ...emptyStudioEvidence, scan: savedStudioScan }
  const reply = composeSavedReply('brief', 'brief', data)
  expect(reply.status).toBe('evidenced')
  expect(reply.coverage).toEqual({ pulse: 'missing', citations: 'missing', scan: 'present', live: 'unsupported' })
  expect(composeSavedReply('pulse', 'pulse', data).status).toBe('insufficient')
  const unknownScan = structuredClone(data)
  unknownScan.scan!.evidence.checks[0].collection = 'unknown'
  expect(composeSavedReply('brief', 'brief', unknownScan).status).toBe('insufficient')
})
it('retrieves Chinese excerpts without claiming a verified answer, even with a long pasted question', () => {
  const data = structuredClone(savedStudioEvidence)
  data.observations[0].excerpt = '廣東話麵包觀察，僅供參考。'
  const start = performance.now()
  const reply = composeSavedReply('廣東話麵包'.repeat(4000), null, data)
  expect(reply.observations).toHaveLength(1)
  expect(reply.status).toBe('insufficient')
  // Generous headroom for CI; quadratic code-point conversion froze the UI.
  expect(performance.now() - start).toBeLessThan(2000)
})

it('reports only the saved composition steps supported by this turn’s inputs and extracts', () => {
  expect(composeSavedReply('brief', 'brief', emptyStudioEvidence).researchSteps).toEqual([])
  expect(composeSavedReply('brief', 'brief', { ...emptyStudioEvidence, week: '2026-10-26' }).researchSteps).toEqual([])
  expect(composeSavedReply('pulse', 'pulse', savedStudioEvidence).researchSteps).toEqual([
    { kind: 'loadWeek', week: '2026-10-26', count: 1 }, { kind: 'selectRecords' }, { kind: 'composeExtracts' },
  ])
  // Selection ran against available records, but no matching extracts were composed.
  expect(composeSavedReply('unrelated helicopters', null, savedStudioEvidence).researchSteps).toEqual([
    { kind: 'loadWeek', week: '2026-10-26', count: 1 }, { kind: 'selectRecords' },
  ])
  const missingText = structuredClone(savedStudioEvidence)
  missingText.observations[0].excerpt = null
  expect(composeSavedReply('pulse', 'pulse', missingText).researchSteps.map(step => step.kind)).toEqual(['loadWeek', 'selectRecords'])
  expect(composeSavedReply('brief', 'brief', { ...emptyStudioEvidence, scan: savedStudioScan }).researchSteps).toEqual([
    { kind: 'selectRecords' }, { kind: 'composeExtracts' },
  ])
  expect(composeSavedReply('pulse', 'pulse', { ...emptyStudioEvidence, scan: savedStudioScan }).researchSteps).toEqual([])
})
