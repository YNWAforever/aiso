import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Encryption at rest for Google refresh tokens (spec §2, §5).
 *
 * AES-256-GCM in the app, so the key never reaches SQL. The stored blob is
 * iv(12) || tag(16) || ciphertext, and each row records the id of the key that
 * sealed it, so a rotation keeps opening old rows through
 * GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS while re-sealing under the new key.
 *
 * No plaintext fallback exists anywhere: a missing key throws, and callers turn
 * that into a 500 before touching anything.
 */

export type VaultErrorCode = 'VAULT_KEY_MISSING' | 'VAULT_KEY_UNKNOWN' | 'VAULT_CIPHERTEXT_INVALID'

export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode) {
    super(code)
    this.name = 'VaultError'
  }
}

export type SealedToken = { ciphertext: Buffer; keyId: string }

export type VaultEnv = {
  GOOGLE_TOKEN_ENCRYPTION_KEY?: string
  GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS?: string
}

const IV_BYTES = 12
const TAG_BYTES = 16

function parseKey(encoded: string | undefined): Buffer | null {
  if (!encoded) return null
  const key = Buffer.from(encoded.trim(), 'base64')
  return key.length === 32 ? key : null
}

/** An identity for the key, not a secret: 16 hex chars of a domain-separated SHA-256. */
export function vaultKeyId(encoded: string): string {
  return createHash('sha256').update(`aiso-google-vault:${encoded.trim()}`).digest('hex').slice(0, 16)
}

function currentKey(env: VaultEnv): { key: Buffer; id: string } {
  const key = parseKey(env.GOOGLE_TOKEN_ENCRYPTION_KEY)
  if (!key) throw new VaultError('VAULT_KEY_MISSING')
  return { key, id: vaultKeyId(env.GOOGLE_TOKEN_ENCRYPTION_KEY!) }
}

/** Throws VAULT_KEY_MISSING when unusable. Routes call it first to fail closed. */
export function assertVaultConfigured(env: VaultEnv = process.env as VaultEnv): void {
  currentKey(env)
}

export function sealToken(plain: string, env: VaultEnv = process.env as VaultEnv): SealedToken {
  const { key, id } = currentKey(env)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]), keyId: id }
}

export function openToken(sealed: SealedToken, env: VaultEnv = process.env as VaultEnv): string {
  const candidates = [currentKey(env)]
  const previous = parseKey(env.GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS)
  if (previous) candidates.push({ key: previous, id: vaultKeyId(env.GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS!) })

  const match = candidates.find(candidate => candidate.id === sealed.keyId)
  if (!match) throw new VaultError('VAULT_KEY_UNKNOWN')

  const blob = sealed.ciphertext
  if (blob.length <= IV_BYTES + TAG_BYTES) throw new VaultError('VAULT_CIPHERTEXT_INVALID')
  try {
    const decipher = createDecipheriv('aes-256-gcm', match.key, blob.subarray(0, IV_BYTES))
    decipher.setAuthTag(blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
  } catch {
    // GCM authentication failed. Never return partial plaintext.
    throw new VaultError('VAULT_CIPHERTEXT_INVALID')
  }
}
