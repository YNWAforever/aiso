import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VaultError, openToken, sealToken, vaultKeyId } from '@/lib/integrations/google/vault'

const key = () => randomBytes(32).toString('base64')
const env = (current: string, previous?: string) => ({
  GOOGLE_TOKEN_ENCRYPTION_KEY: current,
  ...(previous ? { GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS: previous } : {}),
})

describe('token vault', () => {
  it('round-trips a token and never stores it in the clear', () => {
    const e = env(key())
    const sealed = sealToken('1//refresh-token-value', e)
    expect(sealed.ciphertext.includes(Buffer.from('refresh-token-value'))).toBe(false)
    expect(openToken(sealed, e)).toBe('1//refresh-token-value')
  })

  it('uses a fresh IV, so the same token seals differently each time', () => {
    const e = env(key())
    expect(sealToken('same', e).ciphertext.equals(sealToken('same', e).ciphertext)).toBe(false)
  })

  it('fails on a tampered ciphertext rather than returning garbage', () => {
    const e = env(key())
    const sealed = sealToken('value', e)
    sealed.ciphertext[sealed.ciphertext.length - 1] ^= 0xff
    expect(() => openToken(sealed, e)).toThrowError(expect.objectContaining({ code: 'VAULT_CIPHERTEXT_INVALID' }))
  })

  it('names an unknown key id distinctly', () => {
    const sealed = sealToken('value', env(key()))
    expect(() => openToken(sealed, env(key()))).toThrowError(expect.objectContaining({ code: 'VAULT_KEY_UNKNOWN' }))
  })

  it('opens a token sealed under the previous key after rotation', () => {
    const old = key()
    const sealed = sealToken('value', env(old))
    expect(openToken(sealed, env(key(), old))).toBe('value')
  })

  it.each([
    ['missing', undefined],
    ['16 bytes instead of 32', Buffer.alloc(16).toString('base64')],
  ])('refuses when the key is %s', (_label, value) => {
    expect(() => sealToken('v', { GOOGLE_TOKEN_ENCRYPTION_KEY: value }))
      .toThrowError(expect.objectContaining({ code: 'VAULT_KEY_MISSING' }))
  })

  it('derives a stable key id that does not reveal the key', () => {
    const k = key()
    expect(vaultKeyId(k)).toBe(vaultKeyId(k))
    expect(vaultKeyId(k)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('throws VaultError', () => {
    expect(() => sealToken('v', {})).toThrow(VaultError)
  })
})
