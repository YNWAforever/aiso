import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))
vi.mock('@/components/onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => null,
}))

import OnboardingPage from '@/app/[lang]/onboarding/page'

type WizardProps = {
  lang: string
  scanId?: string
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

    const props = await renderPage('scan-1')

    expect(props).toMatchObject({
      scanId: 'scan-1',
      initialDomain: 'testbrand.com',
      initialBrand: 'Testbrand',
      initialIndustry: 'technology',
      initialRegion: 'HK',
    })
  })

  it('leaves fields blank when the scan id does not resolve to a row', async () => {
    sqlMock.mockResolvedValue([])

    const props = await renderPage('missing-scan')

    expect(props).toMatchObject({
      scanId: 'missing-scan',
      initialBrand: '',
      initialDomain: '',
      initialIndustry: '',
      initialRegion: '',
    })
  })

  it('degrades to blank fields, not a thrown error, when the lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sqlMock.mockRejectedValue(new Error('connection terminated'))

    const props = await renderPage('scan-1')

    expect(props).toMatchObject({
      scanId: 'scan-1',
      initialBrand: '',
      initialDomain: '',
      initialIndustry: '',
      initialRegion: '',
    })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
