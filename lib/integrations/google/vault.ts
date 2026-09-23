import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Encryption at rest for Google refresh tokens (spec §2, §5).
 *
 * AES-256-GCM in the app, so the key never reaches SQL. The stored blob is
 * iv(12) || tag(16) || ciphertext, and each row records the id of the key that
 * sealed it, so a rotation keeps opening old rows through
 * GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS while re-sealing under the new key.
 * Each ciphertext is also bound via GCM AAD to the account it belongs to, so a
 * row copied into another account's column cannot be opened there.
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

export type VaultContext = { accountId: string }

const IV_BYTES = 12
const TAG_BYTES = 16

/** 16 hex chars of a domain-separated SHA-256 over the DECODED key bytes — never the encoded string, whose padding/alphabet/whitespace varies for the same key. */
function keyIdFromBytes(keyBytes: Buffer): string {
  return createHash('sha256').update('aiso-google-vault:v1:').update(keyBytes).digest('hex').slice(0, 16)
}

function parseKey(encoded: string | undefined): { key: Buffer; id: string } | null {
  if (!encoded) return null
  const trimmed = encoded.trim()
  if (!trimmed) return null
  const key = Buffer.from(trimmed, 'base64')
  if (key.length !== 32) return null
  return { key, id: keyIdFromBytes(key) }
}

/** An identity for the key, not a secret. Decodes then hashes the bytes, so padded / unpadded / base64url spellings of the same key agree. */
export function vaultKeyId(encoded: string): string {
  const parsed = parseKey(encoded)
  if (!parsed) throw new VaultError('VAULT_KEY_MISSING')
  return parsed.id
}

function currentKey(env: VaultEnv): { key: Buffer; id: string } {
  const parsed = parseKey(env.GOOGLE_TOKEN_ENCRYPTION_KEY)
  if (!parsed) throw new VaultError('VAULT_KEY_MISSING')
  return parsed
}

/** null when unset/blank (rotation not in progress); throws VAULT_KEY_MISSING when set but malformed, so a bad deploy fails loudly rather than silently losing the rotation path. */
function previousKey(env: VaultEnv): { key: Buffer; id: string } | null {
  const raw = env.GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS
  if (raw === undefined || !raw.trim()) return null
  const parsed = parseKey(raw)
  if (!parsed) throw new VaultError('VAULT_KEY_MISSING')
  return parsed
}

function aad(context: VaultContext): Buffer {
  if (!context.accountId) throw new Error('vault context requires accountId')
  return Buffer.from(`aiso-google-refresh-token:v1:${context.accountId}`)
}

/** Throws VAULT_KEY_MISSING when unusable. Routes call it first to fail closed. */
export function assertVaultConfigured(env: VaultEnv = process.env as VaultEnv): void {
  currentKey(env)
  previousKey(env)
}

export function sealToken(plain: string, context: VaultContext, env: VaultEnv = process.env as VaultEnv): SealedToken {
  if (!plain) throw new Error('refusing to seal an empty token')
  const { key, id } = currentKey(env)
  const aadBuf = aad(context)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(aadBuf)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]), keyId: id }
}

export function openToken(sealed: SealedToken, context: VaultContext, env: VaultEnv = process.env as VaultEnv): string {
  const aadBuf = aad(context)
  const candidates = [currentKey(env)]
  const previous = previousKey(env)
  if (previous) candidates.push(previous)

  const match = candidates.find(candidate => candidate.id === sealed.keyId)
  if (!match) throw new VaultError('VAULT_KEY_UNKNOWN')

  const blob = sealed.ciphertext
  if (blob.length <= IV_BYTES + TAG_BYTES) throw new VaultError('VAULT_CIPHERTEXT_INVALID')
  try {
    const decipher = createDecipheriv('aes-256-gcm', match.key, blob.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES })
    decipher.setAAD(aadBuf)
    decipher.setAuthTag(blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
  } catch {
    // GCM authentication failed (bad tag, tampered bytes, or wrong AAD/account). Never return partial plaintext.
    throw new VaultError('VAULT_CIPHERTEXT_INVALID')
  }
}
