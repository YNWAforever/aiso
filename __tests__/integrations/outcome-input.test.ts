import { describe, expect, it } from 'vitest'
import { canonicalOutcomeUrl, parseAnalyticsBatch, parseCluster, parseDeployment, parseIndexNow, parseOutcomeWindow } from '@/lib/outcome-integrations/input'

const now = new Date('2026-10-26T12:00:00Z')
const event = { eventId: 'order:synthetic-001', occurredAt: '2026-10-25T10:00:00Z', pageUrl: 'https://example.com/services', sessions: 2, conversions: 1, revenueMinor: 900, currency: 'HKD' }

describe('outcome integration boundaries', () => {
  it('accepts compact canonical first-party measurements without visitor data', () => {
    expect(parseAnalyticsBatch({ events: [event] }, 'example.com', now)).toEqual({ events: [event] })
  })
  it.each([null, [], { events: [] }, { accountId: 'foreign', events: [event] }, { events: [{ ...event, email: 'private@example.com' }] }, { events: [{ ...event, sessions: -1 }] }, { events: [{ ...event, conversions: '1' }] }, { events: [{ ...event, revenueMinor: Infinity }] }, { events: [{ ...event, occurredAt: '2027-01-01' }] }, { events: Array(101).fill(event) }])('refuses malformed or excessive measurement input %j', input => {
    expect(() => parseAnalyticsBatch(input, 'example.com', now)).toThrow('INVALID_OUTCOME_INPUT')
  })
  it.each(['http://127.0.0.1/a', 'https://other.example/a', 'https://user:secret@example.com/a', 'https://example.com/a?email=private', 'https://example.com/a#private', 'https://example.com:8443/a', 'file:///tmp/a'])('refuses unsafe, foreign or private URL input %s', url => {
    expect(() => canonicalOutcomeUrl(url, 'example.com')).toThrow('INVALID_OUTCOME_INPUT')
  })
  it('requires explicit canonical URLs rather than silently merging query-string pages', () => {
    expect(canonicalOutcomeUrl('https://www.example.com/a', 'example.com')).toBe('https://www.example.com/a')
  })
  it('caps IndexNow submission scope and preserves a replay key', () => {
    expect(parseIndexNow({ intentKey: 'submit:001', urls: ['https://example.com/a', 'https://example.com/a'] }, 'example.com')).toEqual({ intentKey: 'submit:001', urls: ['https://example.com/a'] })
    expect(() => parseIndexNow({ intentKey: 'submit:001', urls: Array(101).fill('https://example.com/a') }, 'example.com')).toThrow('INVALID_OUTCOME_INPUT')
  })
  it('validates explicit deployment timing and optional owned identifiers', () => {
    expect(parseDeployment({ intentKey: 'deploy:001', externalId: 'release-123', deployedAt: '2026-10-25T10:00:00Z', urls: ['https://example.com/a'] }, 'example.com', now)).toMatchObject({ externalId: 'release-123', baselineScanId: null, workItemId: null })
    expect(() => parseDeployment({ intentKey: 'deploy:001', externalId: 'release', deployedAt: '2026-10-25', urls: ['https://example.com/a'], baselineScanId: 'foreign' }, 'example.com', now)).toThrow('INVALID_OUTCOME_INPUT')
  })
  it('keeps cluster assignment explicit and bounded', () => {
    expect(parseCluster({ name: 'Services', keywords: [' Services ', 'services'], targetUrl: 'https://example.com/services' }, 'example.com')).toEqual({ name: 'Services', keywords: ['services'], targetUrl: 'https://example.com/services' })
    expect(() => parseCluster({ name: 'Services', keywords: [''], targetUrl: 'https://other.example/' }, 'example.com')).toThrow('INVALID_OUTCOME_INPUT')
  })
  it('bounds dated reads and refuses inverted or normalized invalid dates', () => {
    expect(parseOutcomeWindow(new URLSearchParams('start=2026-10-01&end=2026-10-25'), now)).toEqual({ start: '2026-10-01', end: '2026-10-25' })
    for (const query of ['end=invalid', 'start=2026-02-30&end=2026-03-02', 'start=2026-10-26&end=2026-10-01', 'start=2020-01-01&end=2026-10-25']) expect(() => parseOutcomeWindow(new URLSearchParams(query), now)).toThrow('INVALID_OUTCOME_INPUT')
  })
})
