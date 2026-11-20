import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn(async () => ({ account_id: 'synthetic-account' })) }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('@/components/onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => null,
}))

import OnboardingPage from '@/app/[lang]/onboarding/page'
import { getProfile } from '@/lib/auth'

const testScanId = '11111111-1111-4111-8111-111111111111'

type WizardProps = {
  lang: string
  scanId?: string
  scanProblem?: 'unavailable' | 'lookup-error'
  initialBrand: string
  initialDomain: string
  initialIndustry: string
  initialRegion: string
}

async function renderPage(scan?: string): Promise<WizardProps> {
  const element = await OnboardingPage({
    params: Promise.resolve({ lang: 'en' }),
    searchParams: Promise.resolve({ scan }),
  })
  return (element as ReactElement<WizardProps>).props
}

describe('onboarding page scan pre-fill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProfile).mockResolvedValue({ account_id: 'synthetic-account' } as never)
  })

  it('returns an anonymous first-use visit to the served login route with safe context', async () => {
    vi.mocked(getProfile).mockResolvedValue(null as never)
    await expect(renderPage('11111111-1111-4111-8111-111111111111')).rejects.toThrow('redirect:/en/auth/login?next=%2Fen%2Fonboarding%3Fscan%3D11111111-1111-4111-8111-111111111111')
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('renders blank fields without touching the database when no scanId is supplied', async () => {
    const props = await renderPage()

    expect(sqlMock).not.toHaveBeenCalled()
    expect(props).toMatchObject({
      scanId: undefined,
      initialBrand: '',
      initialDomain: '',
      initialIndustry: '',
      initialRegion: '',
    })
  })

  it('ignores a blank scan query param the same way as a missing one', async () => {
    const props = await renderPage('   ')

    expect(sqlMock).not.toHaveBeenCalled()
    expect(props.scanId).toBeUndefined()
  })

  it('pre-fills brand, domain, industry and region from the scan', async () => {
    sqlMock.mockResolvedValue([{ domain: 'testbrand.com', industry: 'technology', region: 'HK' }])

    const props = await renderPage(testScanId)
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(expect.arrayContaining(['synthetic-account', false]))

    expect(props).toMatchObject({
      scanId: testScanId,
      initialDomain: 'testbrand.com',
      initialBrand: '',
      initialIndustry: 'technology',
      initialRegion: 'HK',
    })
  })

  it('redirects an already associated scan to the exact saved report', async () => {
    const clientId = '22222222-2222-4222-8222-222222222222'
    sqlMock.mockResolvedValue([{ client_id: clientId, owned_client_id: clientId }])
    await expect(renderPage(testScanId)).rejects.toThrow(`redirect:/en/dashboard/${clientId}/result/${testScanId}`)
  })

  it('keeps the saved setup available after a pending scan association', async () => {
    const clientId = '22222222-2222-4222-8222-222222222222'
    sqlMock.mockResolvedValue([{ client_id: clientId, owned_client_id: clientId,
      pending_setup: { intentKey: 'saved-intent', brandName: 'Example', domain: 'example.com', scanId: testScanId } }])
    expect(await renderPage(testScanId)).toHaveProperty('savedSetup', expect.objectContaining({
      clientId, scanId: testScanId, intentKey: 'saved-intent', brandName: 'Example',
    }))
  })

  it('leaves fields blank when the scan id does not resolve to a row', async () => {
    sqlMock.mockResolvedValue([])

    const props = await renderPage(testScanId)

    expect(props).toMatchObject({
      scanId: testScanId,
      scanProblem: 'unavailable',
      initialBrand: '',
      initialDomain: '',
      initialIndustry: '',
      initialRegion: '',
    })
  })

  it('degrades to blank fields, not a thrown error, when the lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sqlMock.mockRejectedValue(new Error('connection terminated'))

    const props = await renderPage(testScanId)

    expect(props).toMatchObject({
      scanId: testScanId,
      scanProblem: 'lookup-error',
      initialBrand: '',
      initialDomain: '',
      initialIndustry: '',
      initialRegion: '',
    })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
