import { describe, it, expect } from 'vitest'
import { normalizeAuthNext } from '@/lib/auth-navigation'
import { safeReturnTo } from '@/lib/auth-return-to'
const client = '11111111-1111-4111-8111-111111111111'
describe('validated return destination', () => {
  it('retains first-use scan context while stripping secrets and ambiguous IDs',()=>{
    expect(safeReturnTo(`/en/onboarding?scan=${client}&access_token=secret`,'en')).toBe(`/en/onboarding?scan=${client}`)
    expect(safeReturnTo('/zh-HK/onboarding?scan=bad','zh-HK')).toBe('/zh-HK/onboarding')
    expect(safeReturnTo(`/en/onboarding?scan=${client}&scan=${client}`,'en')).toBe('/en/onboarding')
  })
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
  it('retains the selected scan and private draft when sign-in returns to Improve', () => {
    const scan = '22222222-2222-4222-8222-222222222222'
    const draft = '33333333-3333-4333-8333-333333333333'
    const target = `/en/dashboard/${client}?step=improve&scanId=${scan}&draft=${draft}`
    expect(normalizeAuthNext('en', `${target}&token=secret`)).toBe(target)
  })
  it('does not adopt invalid or ambiguous selected scan parameters', () => {
    const draft = '33333333-3333-4333-8333-333333333333'
    expect(normalizeAuthNext('en', `/en/dashboard/${client}?step=improve&scanId=foreign&draft=${draft}`))
      .toBe(`/en/dashboard/${client}?step=improve&draft=${draft}`)
    expect(normalizeAuthNext('en', `/en/dashboard/${client}?step=improve&scanId=${client}&scanId=${client}&draft=${draft}`))
      .toBe(`/en/dashboard/${client}?step=improve&draft=${draft}`)
  })
  it.each(['en', 'zh-HK'])('retains selected result and editable draft context in %s', lang => {
    const scan = '22222222-2222-4222-8222-222222222222'
    const draft = '33333333-3333-4333-8333-333333333333'
    const base = `/${lang}/dashboard/${client}`
    expect(safeReturnTo(`${base}?step=results&scanId=${scan}`, lang)).toBe(`${base}?step=results&scanId=${scan}`)
    expect(safeReturnTo(`${base}?step=improve&scanId=${scan}&draft=${draft}&draft=${draft}`, lang))
      .toBe(`${base}?step=improve&scanId=${scan}`)
    expect(safeReturnTo(`${base}?step=improve&scanId=${scan}&draft=//evil.test&Authorization=secret`, lang))
      .toBe(`${base}?step=improve&scanId=${scan}`)
    expect(safeReturnTo(`/${lang}/dashboard?step=improve&scanId=${scan}&draft=${draft}`, lang))
      .toBe(`/${lang}/dashboard?step=improve`)
  })
})
