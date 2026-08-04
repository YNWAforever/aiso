import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  getProfile: vi.fn(),
  loadReportBranding: vi.fn(),
  upsertReportBranding: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getProfile: h.getProfile }))
vi.mock('@/lib/reports/store', () => ({
  loadReportBranding: h.loadReportBranding,
  upsertReportBranding: h.upsertReportBranding,
  ReportStoreError: class ReportStoreError extends Error {},
}))

import { GET, PUT } from '@/app/api/report-branding/route'

const proProfile = {
  id: 'profile-1',
  account_id: 'account-1',
  accounts: {
    plan: 'pro', status: 'active', stripe_subscription_id: 'sub_pro', trial_ends_at: null,
  },
}
const branding = {
  accountId: 'account-1',
  agencyName: 'Acme Agency',
  logoUrl: null,
  primaryColor: '#123ABC',
  contactLabel: 'Contact us',
  contactUrl: 'https://agency.example/contact',
  updatedBy: 'profile-1',
}

function jsonRequest(body: unknown) {
  return new Request('https://app.example/api/report-branding', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('authenticated report branding API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getProfile.mockResolvedValue(proProfile)
    h.loadReportBranding.mockResolvedValue(branding)
    h.upsertReportBranding.mockResolvedValue(branding)
  })

  it('returns 401 with no-store when no authenticated profile exists', async () => {
    h.getProfile.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(h.loadReportBranding).not.toHaveBeenCalled()
  })

  it.each([
    ['free', { plan: 'pro', status: 'active', stripe_subscription_id: null, trial_ends_at: null }],
    ['basic', { plan: 'basic', status: 'active', stripe_subscription_id: 'sub_basic', trial_ends_at: null }],
    ['past_due', { plan: 'pro', status: 'past_due', stripe_subscription_id: 'sub_pro', trial_ends_at: null }],
  ])('fails closed for effective %s accounts', async (_label, account) => {
    h.getProfile.mockResolvedValue({ ...proProfile, accounts: account })

    const response = await GET()

    expect(response.status).toBe(403)
    expect(h.loadReportBranding).not.toHaveBeenCalled()
  })

  it('returns a neutral 404 for a branding row outside the authenticated account', async () => {
    h.loadReportBranding.mockResolvedValue({ ...branding, accountId: 'account-2' })

    const response = await GET()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
  })

  it('returns 503 without leaking authentication or store failures', async () => {
    h.getProfile.mockRejectedValue(new Error('sensitive auth failure'))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ error: 'service_unavailable' })
    expect(JSON.stringify(body)).not.toContain('sensitive')
  })

  it.each([
    ['non-object JSON', []],
    ['unknown field', { ...branding, accountId: 'attacker-account' }],
    ['invalid agency length', { agencyName: '', logoUrl: null, primaryColor: '#123ABC', contactLabel: null, contactUrl: null }],
    ['contact label beyond database limit', { agencyName: 'Agency', logoUrl: null, primaryColor: '#123ABC', contactLabel: 'x'.repeat(81), contactUrl: 'https://agency.example' }],
  ])('rejects malformed branding input: %s', async (_label, body) => {
    const response = await PUT(jsonRequest(body))

    expect(response.status).toBe(400)
    expect(h.upsertReportBranding).not.toHaveBeenCalled()
  })

  it('normalizes and stores only the allowed branding fields for the authenticated account', async () => {
    const response = await PUT(jsonRequest({
      agencyName: '  Acme Agency  ',
      logoUrl: null,
      primaryColor: '#123abc',
      contactLabel: ' Contact us ',
      contactUrl: ' https://agency.example/contact ',
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(h.upsertReportBranding).toHaveBeenCalledWith({
      accountId: 'account-1',
      updatedBy: 'profile-1',
      branding: {
        agencyName: 'Acme Agency',
        logoUrl: null,
        primaryColor: '#123ABC',
        contactLabel: 'Contact us',
        contactUrl: 'https://agency.example/contact',
      },
    })
    expect(await response.json()).toEqual({ branding: {
      agencyName: branding.agencyName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      contactLabel: branding.contactLabel,
      contactUrl: branding.contactUrl,
    } })
  })
})