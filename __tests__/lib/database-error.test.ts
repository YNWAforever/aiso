import { describe, expect, it } from 'vitest'
import { sanitizeDatabaseError } from '@/lib/observability/database-error'

describe('sanitizeDatabaseError', () => {
  it('keeps the approved database code/category mapping and strips private fields', () => {
    const result = sanitizeDatabaseError({
      code: '23503',
      message: 'Key (account_id)=(secret-account) violates foreign key',
      details: 'brand_name=Fotomax',
      hint: 'private hint',
      query: 'insert into clients ...',
      stack: 'Error: private stack',
    }, { correlationId: 'corr-1', route: '/api/dashboard/clients' })

    expect(result).toEqual({
      correlationId: 'corr-1',
      route: '/api/dashboard/clients',
      code: '23503',
      category: 'foreign_key_violation',
    })
    expect(JSON.stringify(result)).not.toContain('secret-account')
    expect(JSON.stringify(result)).not.toContain('Fotomax')
    expect(JSON.stringify(result)).not.toContain('private hint')
    expect(JSON.stringify(result)).not.toContain('insert into')
    expect(Object.keys(result)).toEqual(['correlationId', 'route', 'code', 'category'])
  })

  it.each([
    ['23503', 'foreign_key_violation'],
    ['23505', 'unique_violation'],
    ['23514', 'check_violation'],
    ['42501', 'insufficient_privilege'],
  ] as const)('maps PostgreSQL code %s to %s', (code, category) => {
    expect(sanitizeDatabaseError({ code }, {
      correlationId: 'corr-known',
      route: '/api/dashboard/clients',
    })).toEqual({
      correlationId: 'corr-known',
      route: '/api/dashboard/clients',
      code,
      category,
    })
  })

  it('returns unknown code/category for non-database errors and unapproved codes', () => {
    expect(sanitizeDatabaseError(new Error('private text'), {
      correlationId: 'corr-2',
      route: '/api/dashboard/clients',
    })).toEqual({
      correlationId: 'corr-2',
      route: '/api/dashboard/clients',
      code: 'unknown',
      category: 'unknown',
    })

    expect(sanitizeDatabaseError({ code: '99999', message: 'private text' }, {
      correlationId: 'corr-3',
      route: '/api/dashboard/clients',
    })).toEqual({
      correlationId: 'corr-3',
      route: '/api/dashboard/clients',
      code: 'unknown',
      category: 'unknown',
    })
  })
})
