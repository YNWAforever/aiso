import { describe, it, expect } from 'vitest'
import { normalizeAuthNext } from '@/lib/auth-navigation'
import { safeReturnTo } from '@/lib/auth-return-to'
const client = '11111111-1111-4111-8111-111111111111'
describe('validated return destination', () => {
  it('preserves exact version and run item context after authentication',()=>{
    const sources=`/zh-HK/dashboard/${client}/sources?source=${client}&version=${client}#source-review`
    const run=`/en/dashboard/${client}/observations?run=${client}&runStatus=failed&runCursor=${client}&week=2026-09-28#run-status`
    expect(safeReturnTo(sources,'zh-HK')).toBe(sources)
    expect(safeReturnTo(run,'en')).toBe(`/en/dashboard/${client}/observations?run=${client}&runCursor=${client}&runStatus=failed&week=2026-09-28#run-status`)
    expect(safeReturnTo(`/en/dashboard/${client}/sources?source=${client}&version=bad`,'en')).toBe(`/en/dashboard/${client}/sources`)
  })
  it.each([null, [], { next: '/en/dashboard' }, '/en/dashboard?step=monitor&step=roi', '/en/dashboard#access_token=secret'])('does not adopt ambiguous context %j', raw => {
    expect(safeReturnTo(raw, 'en')).toBe('/en/dashboard')
  })
  it.each(['entities', 'sources', 'observations', 'opportunities', 'prompts'])('retains deep link to %s', tool => {
    const path = `/zh-HK/dashboard/${client}/${tool}`
    expect(normalizeAuthNext('zh-HK', path)).toBe(path)
  })
  it.each(['//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/%252f%252fevil.test', 'javascript:alert(1)', '/en/auth/login', '/en/auth/complete?next=/en/auth/login', '/en/not-a-route', '/en/dashboard/%252e%252e/auth/login', '/en/dashboard\r\nlocation:evil'])('rejects unsafe or looping destination %s', raw => {
    expect(normalizeAuthNext('en', raw)).toBe('/en/dashboard')
  })
  it('keeps known business context while removing session secrets', () => {
    expect(normalizeAuthNext('en', `/en/dashboard/${client}?step=monitor&neon_auth_session_verifier=secret&access_token=secret&code=secret&next=//evil.test`)).toBe(`/en/dashboard/${client}?step=monitor`)
  })
  it('retains a selected private draft id without arbitrary query data', () => {
    expect(normalizeAuthNext('en', `/en/dashboard/${client}/opportunities?draft=${client}&token=secret`)).toBe(`/en/dashboard/${client}/opportunities?draft=${client}`)
  })
})
