import { describe, expect, it } from 'vitest'
import { StaffAccessPanel } from '@/components/dashboard/StaffAccessPanel'
import { renderWithIntl } from '../helpers/intl'
import type { StaffAuditDto, StaffGrantDto } from '@/lib/staff-grants/schema'

const grant = (over: Partial<StaffGrantDto>): StaffGrantDto => ({
  id: 'g1', grantee: { name: 'Staff One', email: 'staff@fimmick.com' }, grantedBy: 'owner',
  grantedAt: '2026-11-03T00:00:00.000Z', expiresAt: '2027-02-01T00:00:00.000Z', revokedAt: null, status: 'active', ...over,
})
const audit: StaffAuditDto[] = [{ id: 'a1', action: 'open', actor: 'Staff One', brand: 'Bakery', at: '2026-11-03T05:00:00.000Z' }]

describe('StaffAccessPanel', () => {
  it.each(['en', 'zh-HK'] as const)('lists grants with renew/revoke only while unrevoked, and the audit (%s)', locale => {
    const html = renderWithIntl(<StaffAccessPanel grants={[grant({}), grant({ id: 'g2', grantee: { name: 'Gone', email: null }, status: 'revoked', revokedAt: '2026-11-04T00:00:00.000Z' })]} audit={audit} />, locale)
    expect(html).toContain('Staff One')
    expect(html).toContain('2027-02-01')
    expect(html).toContain('2026-11-04')
    expect(html.match(/aria-label="[^"]*Staff One[^"]*"/g)).toHaveLength(2) // renew + revoke for the live grant only
    expect(html).not.toMatch(/aria-label="[^"]*Gone[^"]*"/)
    expect(html).toContain('Bakery')
    expect(html).not.toContain('staffAccess.') // every key resolves
  })

  it('says it could not load rather than showing an empty list', () => {
    const html = renderWithIntl(<StaffAccessPanel grants={[]} audit={audit} loadFailed />)
    expect(html).toContain('Staff access could not be loaded just now')
    expect(html).not.toContain('No staff have access')
    expect(html).not.toContain('Bakery')
  })
})
