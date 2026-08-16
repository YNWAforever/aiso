import { describe, expect, it } from 'vitest'

import { coldStartHint, describeError } from '@/scripts/migrate'

/**
 * A real DSN shape, kept in one place so every assertion below redacts the same
 * literal. Not a live credential.
 */
const DSN = 'postgresql://neondb_owner:npg_S3cr3tPassw0rd@ep-dawn-glade-aoio1qs6.neon.tech/neondb'
const PASSWORD = 'npg_S3cr3tPassw0rd'

/**
 * What an auto-suspended Neon compute actually rejects with: an ErrorEvent-shaped
 * object, not an Error, whose message is the empty string. This is the shape that
 * printed a bare `Migration failed:` on 2026-08-16.
 */
function coldStartRejection(): unknown {
  return { type: 'error', message: '', constructor: { name: 'ErrorEvent' }, name: 'ErrorEvent' }
}

describe('describeError', () => {
  it('never returns an empty string for an empty-message rejection', () => {
    const out = describeError(coldStartRejection())

    expect(out).not.toBe('')
    expect(out.trim()).not.toBe('')
  })

  it('names the error type when there is no message to print', () => {
    // The whole point: the operator must learn *something*. Before this, the
    // output after "Migration failed:" was nothing at all.
    const out = describeError(coldStartRejection())

    expect(out).toContain('ErrorEvent')
    expect(out).toContain('no message')
  })

  it('keeps a normal error message intact', () => {
    expect(describeError(new Error('relation "scans" does not exist')))
      .toContain('relation "scans" does not exist')
  })

  it('falls back to code and type when name is absent', () => {
    const out = describeError({ message: '', code: 'ECONNRESET', type: 'error' })

    expect(out).toContain('ECONNRESET')
    expect(out).toContain('type=error')
  })

  it('does not throw on null, undefined or a primitive rejection', () => {
    // `String(err.message)` threw a TypeError here, replacing the real failure
    // with a misleading one.
    expect(() => describeError(null)).not.toThrow()
    expect(() => describeError(undefined)).not.toThrow()
    expect(() => describeError('plain string failure')).not.toThrow()

    expect(describeError(null)).toContain('null')
    expect(describeError(undefined)).toContain('undefined')
  })

  it('surfaces a cause that carries the real detail', () => {
    const err = new Error('')
    err.cause = new Error('getaddrinfo ENOTFOUND ep-dawn-glade.neon.tech')

    expect(describeError(err)).toContain('ENOTFOUND')
  })

  it('surfaces the members of an AggregateError', () => {
    const err = new AggregateError(
      [new Error('attempt 1 refused'), new Error('attempt 2 refused')],
      '',
    )

    const out = describeError(err)
    expect(out).toContain('attempt 1 refused')
    expect(out).toContain('attempt 2 refused')
  })
})

describe('describeError redaction — the guarantee that must not weaken', () => {
  it('redacts a DSN in the message', () => {
    const out = describeError(new Error(`connection failed: ${DSN}`))

    expect(out).not.toContain(PASSWORD)
    // The host is deliberately kept — knowing which endpoint answered is what
    // stops someone migrating the wrong database by accident.
    expect(out).toContain('ep-dawn-glade-aoio1qs6.neon.tech')
  })

  it('redacts a DSN hidden in the cause, not just the message', () => {
    // The fallback chain is new attack surface: a field that was never printed
    // before is printed now, so it has to be redacted too.
    const err = new Error('')
    err.cause = new Error(`upstream rejected ${DSN}`)

    expect(describeError(err)).not.toContain(PASSWORD)
  })

  it('redacts a DSN inside an AggregateError member', () => {
    const err = new AggregateError([new Error(`attempt failed for ${DSN}`)], '')

    expect(describeError(err)).not.toContain(PASSWORD)
  })

  it('redacts a bare npg_ token appearing in any branch', () => {
    expect(describeError(new Error(`token ${PASSWORD} rejected`))).not.toContain(PASSWORD)
    expect(describeError({ message: '', name: PASSWORD })).not.toContain(PASSWORD)
  })

  it('redacts a DSN carried on a primitive rejection', () => {
    expect(describeError(`raw failure ${DSN}`)).not.toContain(PASSWORD)
  })
})

describe('coldStartHint', () => {
  it('fires for the empty-message ErrorEvent a suspended compute produces', () => {
    const hint = coldStartHint(coldStartRejection())

    expect(hint).toBeDefined()
    expect(hint).toContain('re-run')
  })

  it('stays silent for a real failure that carries a message', () => {
    // Dressing a genuine error up as a transient cold start would send the
    // operator into a retry loop instead of reading the actual problem.
    expect(coldStartHint(new Error('relation "scans" does not exist'))).toBeUndefined()
    expect(coldStartHint(new Error(`syntax error near ${DSN}`))).toBeUndefined()
  })

  it('stays silent for an empty-message error that looks nothing like a socket', () => {
    expect(coldStartHint(new Error(''))).toBeUndefined()
    expect(coldStartHint(null)).toBeUndefined()
  })

  it('tells the operator to confirm rather than assume the outcome', () => {
    expect(coldStartHint(coldStartRejection())).toContain('--verify')
  })
})
