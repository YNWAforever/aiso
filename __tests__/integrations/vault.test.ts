import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VaultError, assertVaultConfigured, openToken, sealToken, vaultKeyId } from '@/lib/integrations/google/vault'

const key = () => randomBytes(32).toString('base64')
const env = (current: string, previous?: string) => ({
  GOOGLE_TOKEN_ENCRYPTION_KEY: current,
  ...(previous ? { GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS: previous } : {}),
})
const ctx = (accountId = 'acct_1') => ({ accountId })

describe('token vault', () => {
  it('round-trips a token and never stores it in the clear', () => {
    const e = env(key())
    const sealed = sealToken('1//refresh-token-value', ctx(), e)
    expect(sealed.ciphertext.includes(Buffer.from('refresh-token-value'))).toBe(false)
    expect(openToken(sealed, ctx(), e)).toBe('1//refresh-token-value')
  })

  it('uses a fresh IV, so the same token seals differently each time', () => {
    const e = env(key())
    expect(sealToken('same', ctx(), e).ciphertext.equals(sealToken('same', ctx(), e).ciphertext)).toBe(false)
  })

  it('fails on a tampered ciphertext rather than returning garbage', () => {
    const e = env(key())
    const sealed = sealToken('value', ctx(), e)
    sealed.ciphertext[sealed.ciphertext.length - 1] ^= 0xff
    expect(() => openToken(sealed, ctx(), e)).toThrowError(expect.objectContaining({ code: 'VAULT_CIPHERTEXT_INVALID' }))
  })

  it('names an unknown key id distinctly', () => {
    const sealed = sealToken('value', ctx(), env(key()))
    expect(() => openToken(sealed, ctx(), env(key()))).toThrowError(expect.objectContaining({ code: 'VAULT_KEY_UNKNOWN' }))
  })

  it('opens a token sealed under the previous key after rotation', () => {
    const old = key()
    const sealed = sealToken('value', ctx(), env(old))
    expect(openToken(sealed, ctx(), env(key(), old))).toBe('value')
  })

  it.each([
    ['missing', undefined],
    ['16 bytes instead of 32', Buffer.alloc(16).toString('base64')],
  ])('refuses when the key is %s', (_label, value) => {
    expect(() => sealToken('v', ctx(), { GOOGLE_TOKEN_ENCRYPTION_KEY: value }))
      .toThrowError(expect.objectContaining({ code: 'VAULT_KEY_MISSING' }))
  })

  it('derives a stable key id that does not reveal the key', () => {
    const k = key()
    expect(vaultKeyId(k)).toBe(vaultKeyId(k))
    expect(vaultKeyId(k)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('throws a VaultError instance carrying the right code', () => {
    try {
      sealToken('v', ctx(), {})
      expect.unreachable('sealToken should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(VaultError)
      expect((err as VaultError).code).toBe('VAULT_KEY_MISSING')
    }
  })

  it('agrees on the key id across padded, unpadded and base64url spellings of the same key, and cross-opens', () => {
    const bytes = randomBytes(32)
    const padded = bytes.toString('base64')
    const unpadded = padded.replace(/=+$/, '')
    const base64url = bytes.toString('base64url')

    const idPadded = vaultKeyId(padded)
    const idUnpadded = vaultKeyId(unpadded)
    const idBase64url = vaultKeyId(base64url)
    expect(idUnpadded).toBe(idPadded)
    expect(idBase64url).toBe(idPadded)

    const sealed = sealToken('cross-form', ctx(), env(padded))
    expect(openToken(sealed, ctx(), env(unpadded))).toBe('cross-form')
    expect(openToken(sealed, ctx(), env(base64url))).toBe('cross-form')
  })

  it('refuses to open a ciphertext under a different account id', () => {
    const e = env(key())
    const sealed = sealToken('value', ctx('acct_1'), e)
    expect(() => openToken(sealed, ctx('acct_2'), e)).toThrowError(expect.objectContaining({ code: 'VAULT_CIPHERTEXT_INVALID' }))
  })

  it.each([28, 10])('rejects a truncated %i-byte blob', (length) => {
    const e = env(key())
    const sealed = sealToken('value', ctx(), e)
    const truncated = { ciphertext: sealed.ciphertext.subarray(0, length), keyId: sealed.keyId }
    expect(() => openToken(truncated, ctx(), e)).toThrowError(expect.objectContaining({ code: 'VAULT_CIPHERTEXT_INVALID' }))
  })

  it('rejects a tampered IV', () => {
    const e = env(key())
    const sealed = sealToken('value', ctx(), e)
    sealed.ciphertext[0] ^= 0xff
    expect(() => openToken(sealed, ctx(), e)).toThrowError(expect.objectContaining({ code: 'VAULT_CIPHERTEXT_INVALID' }))
  })

  it('rejects a tampered auth tag', () => {
    const e = env(key())
    const sealed = sealToken('value', ctx(), e)
    sealed.ciphertext[12] ^= 0xff // first byte of the 16-byte tag, right after the 12-byte IV
    expect(() => openToken(sealed, ctx(), e)).toThrowError(expect.objectContaining({ code: 'VAULT_CIPHERTEXT_INVALID' }))
  })

  it('treats a malformed previous key as misconfiguration in openToken', () => {
    const e = env(key(), 'not-a-valid-key')
    const sealed = sealToken('value', ctx(), env(e.GOOGLE_TOKEN_ENCRYPTION_KEY))
    expect(() => openToken(sealed, ctx(), e)).toThrowError(expect.objectContaining({ code: 'VAULT_KEY_MISSING' }))
  })

  it('treats a malformed previous key as misconfiguration in assertVaultConfigured', () => {
    const e = env(key(), 'not-a-valid-key')
    expect(() => assertVaultConfigured(e)).toThrowError(expect.objectContaining({ code: 'VAULT_KEY_MISSING' }))
  })

  it('never seals under the previous key, even when one is configured', () => {
    const current = key()
    const old = key()
    const sealed = sealToken('value', ctx(), env(current, old))
    expect(sealed.keyId).toBe(vaultKeyId(current))
  })

  it('round-trips when the previous key equals the current key', () => {
    const k = key()
    const sealed = sealToken('value', ctx(), env(k, k))
    expect(openToken(sealed, ctx(), env(k, k))).toBe('value')
  })

  it('refuses to seal an empty token', () => {
    expect(() => sealToken('', ctx(), env(key()))).toThrowError('refusing to seal an empty token')
  })
})
