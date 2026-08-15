import { describe, expect, it } from 'vitest'

import { redactSecrets } from '@/lib/security/redact-secrets'

describe('redactSecrets', () => {
  it('redacts the password from a connection URI but keeps the host', () => {
    // The exact shape that leaked: neonctl branches create printed this to stdout.
    const line = 'postgresql://neondb_owner:npg_yxgMD67vcGVS@ep-lively-wildflower-aoit3bpm.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'

    const out = redactSecrets(line)

    expect(out).not.toContain('npg_yxgMD67vcGVS')
    // The host is diagnostic, not secret — losing it makes output useless for
    // the one thing it is good for, telling you which database you are on.
    expect(out).toContain('ep-lively-wildflower-aoit3bpm')
    expect(out).toContain('neondb_owner')
    expect(out).toContain(':***@')
  })

  it('redacts regardless of URI scheme', () => {
    for (const scheme of ['postgres', 'postgresql', 'https', 'redis']) {
      const out = redactSecrets(`${scheme}://user:hunter2@host.example/db`)
      expect(out, scheme).not.toContain('hunter2')
      expect(out, scheme).toContain('host.example')
    }
  })

  it('redacts a bare Neon password token with no URI around it', () => {
    // Defence in depth: neonctl also prints tokens outside a URI, and the
    // migrate runner's old regex only matched a full postgresql:// URI.
    const out = redactSecrets('password: npg_yxgMD67vcGVS')
    expect(out).not.toContain('npg_yxgMD67vcGVS')
    expect(out).toContain('npg_***')
  })

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const out = redactSecrets(`authorization:Bearer ${jwt}`)
    expect(out).not.toContain(jwt)
    expect(out).toContain('***jwt***')
  })

  it('redacts every occurrence on a line, not just the first', () => {
    const out = redactSecrets(
      'a=postgres://u:p1@h1/db b=postgres://u:p2@h2/db',
    )
    expect(out).not.toContain('p1')
    expect(out).not.toContain('p2')
  })

  it('leaves output with no secrets untouched', () => {
    const clean = 'Applied 6 migration(s).'
    expect(redactSecrets(clean)).toBe(clean)
  })

  it('handles multi-line input, which is what a piped command produces', () => {
    const out = redactSecrets('line one\npostgres://u:secret@h/db\nline three')
    expect(out).not.toContain('secret')
    expect(out.split('\n')).toHaveLength(3)
  })

  it('is a no-op on empty input rather than throwing', () => {
    expect(redactSecrets('')).toBe('')
  })

  it('redacts a credential containing a raw slash', () => {
    // The delimiter scan lands inside the secret here; the old regex failed open
    // and returned this line byte-identical.
    const out = redactSecrets('postgres://neondb_owner:npg/yxgMD67vcGVS@ep-lively.neon.tech/neondb')
    expect(out).not.toContain('npg/yxgMD67vcGVS')
    expect(out).toContain('ep-lively.neon.tech')
  })

  it('redacts a credential on a URI with no username', () => {
    const out = redactSecrets('postgres://:password123@host/db')
    expect(out).not.toContain('password123')
    expect(out).toContain('host')
  })

  it('redacts the whole credential when it contains an @', () => {
    const out = redactSecrets('postgres://neondb_owner:AB12@REALSECRET@ep-x.neon.tech/db')
    expect(out).not.toContain('REALSECRET')
  })

  it('leaves a passwordless URI alone rather than implying a secret', () => {
    expect(redactSecrets('postgres://myuser@host/db')).toBe('postgres://myuser@host/db')
  })

  it('does not mangle prose that carries a URL and an email address', () => {
    const prose = 'see https://docs.example.com and mail foo@bar.com'
    expect(redactSecrets(prose)).toBe(prose)
  })

  it('redacts short and separator-bearing Neon tokens', () => {
    for (const token of ['npg_abc1234', 'npg_abc_123456', 'npg_abc-123456']) {
      expect(redactSecrets(`password: ${token}`), token).not.toContain(token)
    }
  })

  it('completes promptly on a long non-matching line', () => {
    // The regex version backtracked quadratically here: 40k chars took 3.6s and
    // 200k never finished, which would hang the neonctl pipe in Task 2.
    const hostile = `${'a'.repeat(200_000)}!`
    const started = Date.now()
    redactSecrets(hostile)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
