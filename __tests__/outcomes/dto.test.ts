import { expect, test } from 'vitest'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { input, evidence } from './fixtures'
const valid = () => evaluateOutcomes(input({ candidates: [evidence('a','2026-09-14T00:00:00Z')] }))
test('accepts safe evaluator response', () => expect(parseOutcomeResponse(valid())).toEqual(valid()))
test.each(['extra','date','days','selected','bounds','scope','reason','id','limit','anchor','delta','provisional','evidence'] as const)('rejects malformed %s', mutation => {
  const response = valid()
  switch (mutation) {
    case 'extra': Object.assign(response.baseline!, { rawAnswer: 'secret' }); break
    case 'date': response.evaluatedAt = '2026-02-30T00:00:00Z'; break
    case 'days': response.windows[1].day = 7; break
    case 'selected': response.windows[0].timeState = 'missing-evidence'; break
    case 'bounds': response.windows[0].endsAt = response.windows[0].startsAt; break
    case 'scope': response.windows[0].selected!.source.checkKey = 'c2_llms_txt'; break
    case 'reason': response.reasons.push('arbitrary.translation.key'); break
    case 'id': response.versionId = 'x'.repeat(300); break
    case 'limit': response.diagnostics = Array(403).fill(evidence()); break
    case 'anchor': response.anchor = null; break
    case 'delta': Object.assign(response.windows[0], { delta: 1 }); break
    case 'provisional': response.windows[0].provisional = false; break
    case 'evidence': response.windows[0].evidenceState = 'available'; break
  }
  expect(() => parseOutcomeResponse(response)).toThrow()
})

test('rejects timed same-subject rows disguised as diagnostics', () => {
  const response = valid()
  response.diagnostics = [evidence('hidden','2026-09-13T00:00:00Z')]
  expect(() => parseOutcomeResponse(response)).toThrow()
})
test('rejects duplicate diagnostic references', () => {
  const response = evaluateOutcomes(input({ candidates: [evidence('untimed',null)] }))
  response.diagnostics.push(evidence('untimed',null))
  expect(() => parseOutcomeResponse(response)).toThrow()
})
test.each(['no-delivery','withdrawn'] as const)('accepts disabled %s', anchorState => {
  const response = evaluateOutcomes(input({ anchorState, anchor: null }))
  expect(parseOutcomeResponse(response)).toEqual(response)
})
test.each([{ truncated: true }, { sourceState: 'unavailable' as const }, { baseline: null }, { baseline: evidence('untimed',null) }])('accepts limited or invalid evidence state', overrides => {
  const response = evaluateOutcomes(input(overrides))
  expect(parseOutcomeResponse(response)).toEqual(response)
})
