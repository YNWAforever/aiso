# Search Console Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Pro or Enterprise account connect a Google login, bind one Search Console property per brand, and see measured daily search metrics for the property and each registered page.

**Architecture:** Pure modules under `lib/integrations/` (vault, consent cookie, OAuth, Search Console client, binding rule, state derivation) with injected `fetch`, one SQL store, a sync orchestrator, five route handlers, and a daily cron route called from the existing Cloudflare worker schedule. Migration `054` adds five tenant tables tied together by composite foreign keys. Everything is dark behind `FEATURE_SEARCH_CONSOLE`.

**Tech Stack:** TypeScript 5.9, Next.js 16 App Router route handlers, `@neondatabase/serverless` tagged templates, `node:crypto` (AES-256-GCM, HMAC, SHA-256), Vitest 4 (unit, `renderToStaticMarkup` component tests, exact-target integration).

**Spec:** `docs/superpowers/specs/2026-09-24-search-console-connector-design.md`. Read it first; this plan implements it and does not restate its reasoning.

---

## Ground rules for whoever executes this

- **Next.js 16.** Read `node_modules/next/dist/docs/` before writing a route handler or page. Route `params` and page `searchParams` are `Promise`s.
- **Database.** `const sql = db()` from `@/lib/db`, tagged templates only — `sql(someString)` throws. Never `returning *` on a statement that joins another table. Every statement touching a tenant table names `account_id` in its own text.
- **Never return 2xx over a failed write.** `db()` throws; wrap and return 5xx.
- **GateGuard is active in this repo.** Before the first edit of any file, state *in a message before the tool call*: the file's importers, the affected API, any data schema, and the user's instruction. Before any destructive shell command, state what it touches and the rollback. Facts in the same message as the tool call do not count.
- **Client components** in this repo do **not** use `useTranslations`. They import `@/messages/en.json` and `@/messages/zh-HK.json` and select by a `lang` prop (see `components/dashboard/AssetConvergenceView.tsx`). Component tests render with `renderToStaticMarkup` from `react-dom/server`; Testing Library is not installed.
- **Tests.** Unit: `npx vitest run <path>`. The real-Postgres suite runs **only** through `node scripts/ci/run-exact-target-suites.mjs` (provisions a disposable Neon branch; needs `neonctl` signed in). Before any push run all of: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration`, the wrapper, and the cron worker's own tests. Run the **whole** integration project, never one file: suites share a branch, and a fixture that passes alone can collide with another (it failed CI on PR #53).
- **Fixtures:** `accounts.stripe_subscription_id` is unique across the shared branch — use `'sub_' + <full uuid>`, never a suffix.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branch:** `claude/phase2-search-console` from current `main`.

## File structure

**Create**

| Path | Responsibility |
|---|---|
| `lib/integrations/google/vault.ts` | AES-256-GCM seal/open; key id; previous key for rotation |
| `lib/integrations/google/consent-state.ts` | Sign/verify the short-lived consent cookie |
| `lib/integrations/google/consent-reasons.ts` | The one list of consent refusal reasons (dependency-free; the client panel imports it) |
| `lib/integrations/google/oauth.ts` | Config, PKCE, consent URL, code exchange, refresh, revoke, failure classification |
| `lib/integrations/search-console/client.ts` | `listSites`, `querySearchAnalytics` |
| `lib/integrations/search-console/binding.ts` | Pure eligibility: property ↔ brand domain |
| `lib/integrations/search-console/state.ts` | Pure: ledger + current facts → what the owner sees |
| `lib/integrations/search-console/store.ts` | All SQL |
| `lib/integrations/search-console/sync.ts` | Sync one binding → one ledger outcome |
| `lib/integrations/search-console/guard.ts` | flag → auth → entitlement → ownership |
| `supabase/migrations/054_search_console.sql` | Five tables, constraints, grants |
| `app/api/integrations/google/start/route.ts` | GET: begin consent |
| `app/api/integrations/google/callback/route.ts` | GET: finish consent |
| `app/api/account/integrations/google/route.ts` | GET list / DELETE revoke |
| `app/api/dashboard/clients/[clientId]/search-console/route.ts` | GET / PUT bind / DELETE unbind |
| `app/api/cron/search-console/route.ts` | GET: daily sync |
| `components/integrations/GoogleConnectionsPanel.tsx` | Settings panel |
| `components/integrations/SearchConsolePanel.tsx` | Brand panel + `SearchConsoleStateNotice` |
| `vitest.search-console-integration.config.ts` | Exact-target config |
| `__tests__/integrations/{vault,consent-state,oauth,search-console-client,binding,state,guard,sync}.test.ts` | Unit tests |
| `__tests__/api/search-console-{consent,connections,binding,cron}.test.ts` | Route tests |
| `__tests__/migrations/search-console-migration.test.ts` | Static assertions on `054` |
| `__tests__/integration/search-console.test.ts` | Real Postgres |
| `__tests__/components/search-console-bilingual.test.tsx` | Every owner state, both locales |
| `__tests__/lib/flags.test.ts` | The new flag |

**Modify**

| Path | Change |
|---|---|
| `lib/flags.ts` | `FeatureFlag` gains `'search_console'` |
| `lib/plans/catalog.ts` | `PlanFeatures.search_console`; set on all four plans |
| `lib/security/redact-secrets.ts` | Google token patterns |
| `cloudflare/cron-worker/src/index.ts`, `cloudflare/cron-worker/test/scheduled.test.ts` | One schedule → several independent routes |
| `vercel.json`, `__tests__/config/function-durations.test.ts` | New cron route |
| `__tests__/security/tenancy-inventory.test.ts` | New tenant tables |
| `scripts/ci/run-exact-target-suites.mjs`, `vitest.integration.config.ts`, `__tests__/ci/exact-target-suites.test.ts` | Wire the new suite |
| `messages/en.json`, `messages/zh-HK.json`, `__tests__/lib/message-catalogue-parity.test.ts` | `searchConsole` namespace |
| `app/[lang]/dashboard/settings/page.tsx`, `app/[lang]/dashboard/[clientId]/assets/page.tsx` | Mount panels |
| `.env.example`, `CLAUDE.md` | Variables and rules |

---

### Task 1: Feature flag and plan entitlement

**Files:** Modify `lib/flags.ts`, `lib/plans/catalog.ts`. Test `__tests__/lib/plan-catalog.test.ts` (append), `__tests__/lib/flags.test.ts` (create).

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe` of `__tests__/lib/plan-catalog.test.ts`:

```ts
  it('grants Search Console only to Pro and Enterprise', () => {
    expect(PLAN_CATALOG.free.features.search_console).toBe(false)
    expect(PLAN_CATALOG.basic.features.search_console).toBe(false)
    expect(PLAN_CATALOG.pro.features.search_console).toBe(true)
    expect(PLAN_CATALOG.enterprise.features.search_console).toBe(true)
  })
```

Create `__tests__/lib/flags.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { isFeatureEnabled } from '@/lib/flags'

describe('search_console flag', () => {
  afterEach(() => { delete process.env.FEATURE_SEARCH_CONSOLE })

  it('is off by default', () => {
    expect(isFeatureEnabled('search_console')).toBe(false)
  })

  it('turns on only for the exact value 1', () => {
    process.env.FEATURE_SEARCH_CONSOLE = 'true'
    expect(isFeatureEnabled('search_console')).toBe(false)
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    expect(isFeatureEnabled('search_console')).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run __tests__/lib/plan-catalog.test.ts __tests__/lib/flags.test.ts`
Expected: FAIL — `search_console` is `undefined`.

- [ ] **Step 3: Implement**

`lib/flags.ts`:

```ts
export type FeatureFlag = 'donor_ui_shell' | 'search_console'
```

`lib/plans/catalog.ts` — in `PlanFeatures`, after `client_reports_online: boolean`:

```ts
  /** Google Search Console connector (Phase 2). Runtime entitlement only. */
  search_console: boolean
```

In each plan's `features` object, after `client_reports_online`: `free` and `basic` get `search_console: false`; `pro` and `enterprise` get `search_console: true`. TypeScript refuses to compile until all four have it.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run __tests__/lib/plan-catalog.test.ts __tests__/lib/flags.test.ts __tests__/lib/commercial-entitlement.test.ts` → PASS.
Run: `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/flags.ts lib/plans/catalog.ts __tests__/lib/plan-catalog.test.ts __tests__/lib/flags.test.ts
git commit -m "feat(search-console): add dark flag and Pro/Enterprise entitlement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Token vault

> **Superseded after code review (implemented in two commits).** The shipped vault differs from the code below: `sealToken(plain, { accountId }, env?)` and `openToken(sealed, { accountId }, env?)` bind each ciphertext to its account with GCM AAD; the key id is derived from the decoded key bytes (`aiso-google-vault:v1:`), not the encoded string; the tag length is pinned; a malformed `GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS` fails closed; an empty token is refused. Later tasks in this plan use the shipped signatures. Read `lib/integrations/google/vault.ts` as the source of truth.

**Files:** Create `lib/integrations/google/vault.ts`. Test `__tests__/integrations/vault.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run __tests__/integrations/vault.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
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
export function assertVaultConfigured(env: VaultEnv = process.env): void {
  currentKey(env)
}

export function sealToken(plain: string, env: VaultEnv = process.env): SealedToken {
  const { key, id } = currentKey(env)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]), keyId: id }
}

export function openToken(sealed: SealedToken, env: VaultEnv = process.env): string {
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
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/google/vault.ts __tests__/integrations/vault.test.ts
git commit -m "feat(search-console): AES-256-GCM token vault with key rotation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Redact Google tokens

**Files:** Modify `lib/security/redact-secrets.ts`. Test `__tests__/security/redact-secrets.test.ts` (append). The module must stay dependency-free — `scripts/redact.mjs` loads it under plain node.

- [ ] **Step 1: Write the failing test** — append:

```ts
describe('Google OAuth tokens', () => {
  it('redacts an access token', () => {
    expect(redactSecrets('Authorization: Bearer ya29.a0AfB_byC-abcdefghijklmnop')).toBe('Authorization: Bearer ya29.***')
  })

  it('redacts a refresh token', () => {
    expect(redactSecrets('refresh=1//0gABCDEFghijklmnopQRSTUV-xyz')).toBe('refresh=1//***')
  })

  it('leaves an ordinary short path alone', () => {
    expect(redactSecrets('see https://example.com/1//x')).toBe('see https://example.com/1//x')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run __tests__/security/redact-secrets.test.ts` → FAIL on the first two.

- [ ] **Step 3: Implement** — after the `JWT` constant:

```ts
/** Google OAuth access tokens. */
const GOOGLE_ACCESS = /ya29\.[A-Za-z0-9_-]{8,}/g

/**
 * Google OAuth refresh tokens: `1//` then a long base64url run. The 16-character
 * floor keeps an ordinary `/1//x` path segment out of it.
 */
const GOOGLE_REFRESH = /1\/\/[A-Za-z0-9_-]{16,}/g
```

and replace `redactLine`:

```ts
function redactLine(line: string): string {
  return redactUris(line)
    .replace(NEON_TOKEN, 'npg_***')
    .replace(JWT, '***jwt***')
    .replace(GOOGLE_ACCESS, 'ya29.***')
    .replace(GOOGLE_REFRESH, '1//***')
}
```

- [ ] **Step 4: Run to verify it passes** — PASS, including every pre-existing case.

- [ ] **Step 5: Commit**

```bash
git add lib/security/redact-secrets.ts __tests__/security/redact-secrets.test.ts
git commit -m "feat(security): redact Google OAuth tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Binding rule

**Files:** Create `lib/integrations/search-console/binding.ts`. Test `__tests__/integrations/binding.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { normalizeBrandDomain, propertyEligibility } from '@/lib/integrations/search-console/binding'

describe('normalizeBrandDomain', () => {
  it.each([
    ['Example.COM', 'example.com'],
    ['https://www.example.com/path?q=1', 'example.com'],
    ['www.example.com', 'example.com'],
    ['shop.example.com', 'shop.example.com'],
    ['  example.com  ', 'example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBrandDomain(input)).toBe(expected)
  })

  it.each([null, '', 'localhost', 'not a domain'])('rejects %s', input => {
    expect(normalizeBrandDomain(input)).toBeNull()
  })
})

describe('propertyEligibility', () => {
  const owner = 'siteOwner'

  it.each([
    'sc-domain:example.com', 'https://example.com/', 'http://example.com/',
    'https://www.example.com/', 'http://www.example.com/',
  ])('%s covers example.com', site => {
    expect(propertyEligibility(site, owner, 'example.com')).toEqual({ eligible: true })
  })

  it('lets a Domain property cover a subdomain brand', () => {
    expect(propertyEligibility('sc-domain:example.com', owner, 'shop.example.com')).toEqual({ eligible: true })
  })

  it('does not let a URL-prefix property on one host cover another', () => {
    expect(propertyEligibility('https://blog.example.com/', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('refuses a lookalike that merely ends with the domain', () => {
    expect(propertyEligibility('sc-domain:badexample.com', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('refuses a URL-prefix property scoped to a path', () => {
    expect(propertyEligibility('https://example.com/blog/', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('refuses unverified access even on the right property', () => {
    expect(propertyEligibility('sc-domain:example.com', 'siteUnverifiedUser', 'example.com'))
      .toEqual({ eligible: false, reason: 'unverified' })
  })

  it.each(['siteOwner', 'siteFullUser', 'siteRestrictedUser'])('accepts %s', level => {
    expect(propertyEligibility('sc-domain:example.com', level, 'example.com')).toEqual({ eligible: true })
  })

  it('refuses a brand with no domain', () => {
    expect(propertyEligibility('sc-domain:example.com', owner, null)).toEqual({ eligible: false, reason: 'no_domain' })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * May this Search Console property be bound to this brand? (spec §4.2) Pure.
 *
 * A brand must never show another site's search data under its name, so the
 * property must cover the brand's own domain and the login must hold verified
 * access. A URL-prefix property scoped to a path reports on part of the site
 * only, and presenting it as the brand's performance would overstate it.
 */

export type BindingReason = 'no_domain' | 'other_domain' | 'unverified'
export type BindingVerdict = { eligible: true } | { eligible: false; reason: BindingReason }

const VERIFIED_LEVELS = new Set(['siteOwner', 'siteFullUser', 'siteRestrictedUser'])
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

export function normalizeBrandDomain(domain: string | null | undefined): string | null {
  if (!domain) return null
  let value = domain.trim().toLowerCase()
  if (!value) return null
  if (!/^[a-z]+:\/\//.test(value)) value = `https://${value}`
  let host: string
  try {
    host = new URL(value).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./, '')
  return HOST.test(host) ? host : null
}

function coverage(siteUrl: string): { host: string; subdomains: boolean } | null {
  if (siteUrl.startsWith('sc-domain:')) {
    const host = normalizeBrandDomain(siteUrl.slice('sc-domain:'.length))
    return host ? { host, subdomains: true } : null
  }
  let url: URL
  try {
    url = new URL(siteUrl)
  } catch {
    return null
  }
  if (url.pathname !== '/' || url.search || url.hash) return null
  const host = normalizeBrandDomain(url.hostname)
  return host ? { host, subdomains: false } : null
}

export function propertyEligibility(
  siteUrl: string,
  permissionLevel: string,
  brandDomain: string | null | undefined,
): BindingVerdict {
  const brand = normalizeBrandDomain(brandDomain)
  if (!brand) return { eligible: false, reason: 'no_domain' }

  const covered = coverage(siteUrl)
  const covers = covered !== null
    && (covered.host === brand || (covered.subdomains && brand.endsWith(`.${covered.host}`)))
  if (!covers) return { eligible: false, reason: 'other_domain' }

  if (!VERIFIED_LEVELS.has(permissionLevel)) return { eligible: false, reason: 'unverified' }
  return { eligible: true }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/search-console/binding.ts __tests__/integrations/binding.test.ts
git commit -m "feat(search-console): binding rule — property must cover the brand domain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Consent cookie

**Files:** Create `lib/integrations/google/consent-state.ts`. Test `__tests__/integrations/consent-state.test.ts`. Shape copied from `lib/security/scan-claim-intent.ts`, signed with `shareSigningSecret()` under its own domain string so a claim-intent cookie can never verify here.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { signConsentState, verifyConsentState } from '@/lib/integrations/google/consent-state'

const input = {
  state: 'a'.repeat(43),
  verifier: 'v'.repeat(64),
  profileId: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  returnPath: '/en/dashboard/settings',
}

describe('consent state cookie', () => {
  beforeEach(() => { process.env.REPORT_SHARE_SECRET = 'consent-state-test-secret-0123456789abcdef' })

  it('round-trips within its lifetime', () => {
    const now = 1_000_000
    expect(verifyConsentState(signConsentState(input, now), now + 60_000)).toMatchObject(input)
  })

  it('expires after ten minutes', () => {
    const now = 1_000_000
    expect(verifyConsentState(signConsentState(input, now), now + 10 * 60_000 + 1)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const [payload, sig] = signConsentState(input).split('.')
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
      accountId: '33333333-3333-4333-8333-333333333333',
    })).toString('base64url')
    expect(verifyConsentState(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects an absent cookie', () => {
    expect(verifyConsentState(undefined)).toBeNull()
  })

  it.each(['//evil.example/x', 'https://evil.example/', '/en/result/abc', '/fr/dashboard'])(
    'refuses to sign a return path of %s', returnPath => {
      expect(() => signConsentState({ ...input, returnPath })).toThrow()
    })

  it('accepts a brand dashboard return path', () => {
    const returnPath = '/zh-HK/dashboard/22222222-2222-4222-8222-222222222222/assets'
    expect(verifyConsentState(signConsentState({ ...input, returnPath }))?.returnPath).toBe(returnPath)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { shareSigningSecret } from '@/lib/security/share-secret'

/**
 * Ties a Google consent round-trip to the person who started it (spec §4.1).
 * It carries the PKCE verifier and OAuth state plus the profile and account
 * that began the flow; the callback refuses unless all of them match, so one
 * signed-in person cannot finish another's consent.
 */

export const GOOGLE_CONSENT_COOKIE = 'aiso_google_consent'
export const CONSENT_TTL_MS = 10 * 60 * 1000
export const RETURN_PATH = /^\/(en|zh-HK)\/dashboard(\/[A-Za-z0-9_-]+)*$/

export type ConsentState = {
  state: string
  verifier: string
  profileId: string
  accountId: string
  returnPath: string
  exp: number
}

const DOMAIN = 'aiso-google-consent:v1'
const SIGNATURE_LENGTH = 43

function canonical(p: ConsentState): string {
  return [DOMAIN, p.state, p.verifier, p.profileId, p.accountId, p.returnPath, p.exp].join(':')
}

function sign(p: ConsentState): string {
  return createHmac('sha256', shareSigningSecret()).update(canonical(p)).digest('base64url')
}

function isValid(value: unknown): value is ConsentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return typeof v.state === 'string' && v.state.length >= 32
    && typeof v.verifier === 'string' && v.verifier.length >= 43
    && typeof v.profileId === 'string' && v.profileId.length > 0
    && typeof v.accountId === 'string' && v.accountId.length > 0
    && typeof v.returnPath === 'string' && RETURN_PATH.test(v.returnPath)
    && typeof v.exp === 'number' && Number.isSafeInteger(v.exp)
}

export function signConsentState(input: Omit<ConsentState, 'exp'>, nowMs = Date.now()): string {
  const payload: ConsentState = { ...input, exp: nowMs + CONSENT_TTL_MS }
  if (!isValid(payload)) throw new Error('Invalid consent state')
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sign(payload)}`
}

export function verifyConsentState(token: string | undefined, nowMs = Date.now()): ConsentState | null {
  if (!token) return null
  const [encoded, signature, ...rest] = token.split('.')
  if (!encoded || !signature || rest.length || signature.length !== SIGNATURE_LENGTH) return null
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isValid(payload) || payload.exp <= nowMs) return null
  try {
    const expected = Buffer.from(sign(payload), 'base64url')
    const received = Buffer.from(signature, 'base64url')
    return expected.length === received.length && timingSafeEqual(expected, received) ? payload : null
  } catch {
    // Includes a missing REPORT_SHARE_SECRET: deny rather than crash.
    return null
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/google/consent-state.ts __tests__/integrations/consent-state.test.ts
git commit -m "feat(search-console): signed consent cookie bound to profile and account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Google OAuth client

**Files:** Create `lib/integrations/google/oauth.ts`. Test `__tests__/integrations/oauth.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  GoogleApiError, SEARCH_CONSOLE_SCOPE, buildConsentUrl, classifyGoogleFailure,
  exchangeCode, googleOAuthConfig, pkcePair, refreshAccessToken, revokeToken,
} from '@/lib/integrations/google/oauth'

const cfg = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://app.test/api/integrations/google/callback' }
const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

describe('googleOAuthConfig', () => {
  it('is null unless both credentials are set', () => {
    expect(googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: 'x' }, 'https://a.test')).toBeNull()
    expect(googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: 'x', GOOGLE_OAUTH_CLIENT_SECRET: 'y' }, 'https://a.test/'))
      .toEqual({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://a.test/api/integrations/google/callback' })
  })
})

describe('consent URL', () => {
  it('uses S256 PKCE and asks for offline, forced-consent access', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    const url = new URL(buildConsentUrl(cfg, { state: 's'.repeat(43), challenge }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('code_challenge')).toBe(challenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toBe(`openid email ${SEARCH_CONSOLE_SCOPE}`)
  })
})

describe('exchangeCode', () => {
  it('returns the grant with subject, email and scopes', async () => {
    const f = json(200, {
      access_token: 'ya29.x', refresh_token: '1//r', scope: `openid email ${SEARCH_CONSOLE_SCOPE}`,
      id_token: idToken({ sub: 'g-123', email: 'owner@example.com' }),
    })
    expect(await exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).toEqual({
      accessToken: 'ya29.x', refreshToken: '1//r', subject: 'g-123', email: 'owner@example.com',
      scopes: ['openid', 'email', SEARCH_CONSOLE_SCOPE],
    })
    expect(String(f.mock.calls[0]![1].body)).toContain('code_verifier=v')
  })

  it('reports a missing refresh token as null rather than inventing one', async () => {
    const f = json(200, { access_token: 'ya29.x', scope: SEARCH_CONSOLE_SCOPE, id_token: idToken({ sub: 'g' }) })
    expect((await exchangeCode(cfg, { code: 'c', verifier: 'v' }, f)).refreshToken).toBeNull()
  })
})

describe('refreshAccessToken', () => {
  it('returns the access token', async () => {
    expect(await refreshAccessToken(cfg, '1//r', json(200, { access_token: 'ya29.new' }))).toBe('ya29.new')
  })

  it('throws revoked on invalid_grant', async () => {
    await expect(refreshAccessToken(cfg, '1//r', json(400, { error: 'invalid_grant' }))).rejects.toMatchObject({ kind: 'revoked' })
  })

  it('throws unavailable when the network fails', async () => {
    await expect(refreshAccessToken(cfg, '1//r', vi.fn().mockRejectedValue(new TypeError('fetch failed'))))
      .rejects.toBeInstanceOf(GoogleApiError)
  })
})

describe('classifyGoogleFailure', () => {
  it.each([
    [400, { error: 'invalid_grant' }, 'revoked'],
    [401, {}, 'revoked'],
    [403, {}, 'forbidden'],
    [429, {}, 'quota'],
    [500, {}, 'unavailable'],
    [400, { error: 'invalid_request' }, 'unavailable'],
  ])('%i %j -> %s', (status, body, kind) => {
    expect(classifyGoogleFailure(status, body)).toBe(kind)
  })
})

describe('revokeToken', () => {
  it('is true on 200 and false otherwise, never throwing', async () => {
    expect(await revokeToken('1//r', json(200, {}))).toBe(true)
    expect(await revokeToken('1//r', json(400, {}))).toBe(false)
    expect(await revokeToken('1//r', vi.fn().mockRejectedValue(new Error('down')))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { createHash, randomBytes } from 'node:crypto'

/**
 * Google OAuth for the Search Console connector (spec §4.1, §5). Plain HTTP over
 * an injected fetch, so the caller can see status codes: a dead credential
 * (revoked) and a Google outage (unavailable) lead to different owner states.
 */

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const CALLBACK_PATH = '/api/integrations/google/callback'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export type GoogleFetch = (input: string, init?: RequestInit) => Promise<Response>
export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string }
export type GoogleFailure = 'revoked' | 'forbidden' | 'quota' | 'unavailable'

export class GoogleApiError extends Error {
  constructor(readonly kind: GoogleFailure, readonly status: number) {
    super(`google_${kind}_${status}`)
    this.name = 'GoogleApiError'
  }
}

export type TokenGrant = {
  accessToken: string
  refreshToken: string | null
  subject: string
  email: string | null
  scopes: string[]
}

export function googleOAuthConfig(
  env: { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string },
  origin: string,
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, redirectUri: `${origin.replace(/\/$/, '')}${CALLBACK_PATH}` }
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function randomState(): string {
  return randomBytes(32).toString('base64url')
}

export function buildConsentUrl(cfg: GoogleOAuthConfig, input: { state: string; challenge: string }): string {
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: `openid email ${SEARCH_CONSOLE_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

export function classifyGoogleFailure(status: number, body: unknown): GoogleFailure {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  if (status === 401 || (status === 400 && error === 'invalid_grant')) return 'revoked'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'quota'
  return 'unavailable'
}

async function postForm(url: string, form: Record<string, string>, f: GoogleFetch): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })
  } catch {
    throw new GoogleApiError('unavailable', 0)
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new GoogleApiError(classifyGoogleFailure(res.status, body), res.status)
  return body
}

/**
 * Claims are read without verifying the id_token's signature. That is safe here
 * only because the token came in the direct TLS response from Google's token
 * endpoint to this server, never via the browser.
 */
function idTokenClaims(idToken: unknown): { sub: string; email: string | null } {
  if (typeof idToken !== 'string') throw new GoogleApiError('unavailable', 200)
  let claims: { sub?: unknown; email?: unknown }
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    throw new GoogleApiError('unavailable', 200)
  }
  if (typeof claims.sub !== 'string' || !claims.sub) throw new GoogleApiError('unavailable', 200)
  return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : null }
}

export async function exchangeCode(
  cfg: GoogleOAuthConfig,
  input: { code: string; verifier: string },
  f: GoogleFetch = fetch,
): Promise<TokenGrant> {
  const body = await postForm(TOKEN_URL, {
    code: input.code,
    code_verifier: input.verifier,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  }, f)
  if (typeof body.access_token !== 'string') throw new GoogleApiError('unavailable', 200)
  const { sub, email } = idTokenClaims(body.id_token)
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    subject: sub,
    email,
    scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
  }
}

export async function refreshAccessToken(cfg: GoogleOAuthConfig, refreshToken: string, f: GoogleFetch = fetch): Promise<string> {
  const body = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  }, f)
  if (typeof body.access_token !== 'string') throw new GoogleApiError('unavailable', 200)
  return body.access_token
}

/** Best effort. The caller deletes its own copy whatever this returns (spec §5). */
export async function revokeToken(token: string, f: GoogleFetch = fetch): Promise<boolean> {
  try {
    const res = await f(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/google/oauth.ts __tests__/integrations/oauth.test.ts
git commit -m "feat(search-console): Google OAuth client with PKCE and typed failures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Search Console client

**Files:** Create `lib/integrations/search-console/client.ts`. Test `__tests__/integrations/search-console-client.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { listSites, querySearchAnalytics } from '@/lib/integrations/search-console/client'

const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))

describe('listSites', () => {
  it('returns every property with its permission level', async () => {
    const f = json(200, { siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] })
    expect(await listSites('ya29.t', f)).toEqual([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites')
    expect(init.headers.authorization).toBe('Bearer ya29.t')
  })

  it('treats a login with no properties as an empty list', async () => {
    expect(await listSites('t', json(200, {}))).toEqual([])
  })

  it.each([[401, 'revoked'], [403, 'forbidden'], [429, 'quota'], [502, 'unavailable']])(
    'maps %i to %s', async (status, kind) => {
      await expect(listSites('t', json(status, {}))).rejects.toMatchObject({ kind })
    })
})

describe('querySearchAnalytics', () => {
  it('encodes the property, filters to one page and asks for all data states', async () => {
    const f = json(200, { rows: [{ keys: ['2026-09-20'], clicks: 3, impressions: 40, ctr: 0.075, position: 8.2 }] })
    const rows = await querySearchAnalytics('t', 'sc-domain:example.com', {
      startDate: '2026-09-14', endDate: '2026-09-20', dimensions: ['date'], pageEquals: 'https://example.com/p',
    }, f)
    expect(rows).toEqual([{ keys: ['2026-09-20'], clicks: 3, impressions: 40, ctr: 0.075, position: 8.2 }])
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query')
    const body = JSON.parse(init.body)
    expect(body.dataState).toBe('all')
    expect(body.dimensionFilterGroups)
      .toEqual([{ filters: [{ dimension: 'page', operator: 'equals', expression: 'https://example.com/p' }] }])
  })

  it('returns no rows when Google has none', async () => {
    expect(await querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, json(200, {})))
      .toEqual([])
  })

  it('maps a 403 to forbidden', async () => {
    await expect(querySearchAnalytics('t', 'sc-domain:e.com', { startDate: 'a', endDate: 'b', dimensions: ['date'] }, json(403, {})))
      .rejects.toMatchObject({ kind: 'forbidden' })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { GoogleApiError, classifyGoogleFailure, type GoogleFetch } from '@/lib/integrations/google/oauth'

const BASE = 'https://www.googleapis.com/webmasters/v3'

export type SiteEntry = { siteUrl: string; permissionLevel: string }
export type AnalyticsDimension = 'date' | 'page' | 'query'
export type AnalyticsQuery = {
  startDate: string
  endDate: string
  dimensions: AnalyticsDimension[]
  pageEquals?: string
  rowLimit?: number
}
export type AnalyticsRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

async function call(url: string, accessToken: string, f: GoogleFetch, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await f(url, { ...init, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' } })
  } catch {
    throw new GoogleApiError('unavailable', 0)
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new GoogleApiError(classifyGoogleFailure(res.status, body), res.status)
  return body
}

export async function listSites(accessToken: string, f: GoogleFetch = fetch): Promise<SiteEntry[]> {
  const body = await call(`${BASE}/sites`, accessToken, f)
  const entries = Array.isArray(body.siteEntry) ? body.siteEntry as unknown[] : []
  return entries.flatMap(e => {
    const entry = e as Partial<SiteEntry>
    return typeof entry.siteUrl === 'string' && typeof entry.permissionLevel === 'string'
      ? [{ siteUrl: entry.siteUrl, permissionLevel: entry.permissionLevel }]
      : []
  })
}

/**
 * `dataState: 'all'` includes days Google has not finalised. Those values can
 * change, which is why a routine sync re-fetches the last seven days and the
 * store overwrites them (spec §4.3).
 */
export async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  q: AnalyticsQuery,
  f: GoogleFetch = fetch,
): Promise<AnalyticsRow[]> {
  const body = await call(`${BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, accessToken, f, {
    method: 'POST',
    body: JSON.stringify({
      startDate: q.startDate,
      endDate: q.endDate,
      dimensions: q.dimensions,
      dataState: 'all',
      rowLimit: q.rowLimit ?? 25_000,
      ...(q.pageEquals
        ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: q.pageEquals }] }] }
        : {}),
    }),
  })
  const rows = Array.isArray(body.rows) ? body.rows as unknown[] : []
  return rows.map(r => {
    const row = r as Partial<AnalyticsRow>
    return {
      keys: Array.isArray(row.keys) ? row.keys.map(String) : [],
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      ctr: Number(row.ctr ?? 0),
      position: Number(row.position ?? 0),
    }
  })
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/search-console/client.ts __tests__/integrations/search-console-client.test.ts
git commit -m "feat(search-console): sites and search analytics client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Owner-visible state

**Files:** Create `lib/integrations/search-console/state.ts`. Test `__tests__/integrations/state.test.ts`.

A *current* condition beats an older ledger row: if the plan lapsed or the domain changed since the last run, that is what the owner is told.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { SYNC_OUTCOMES, deriveOwnerState, type OwnerStateInput } from '@/lib/integrations/search-console/state'

const base: OwnerStateInput = {
  bound: true, entitled: true, connectionStatus: 'active', domainMatches: true,
  latest: { outcome: 'ok', dataThrough: '2026-09-20' }, lastGoodDataThrough: '2026-09-20',
}

describe('deriveOwnerState', () => {
  it('is unbound before a property is chosen', () => {
    expect(deriveOwnerState({ ...base, bound: false })).toEqual({ kind: 'unbound' })
  })

  it('waits for the first sync', () => {
    expect(deriveOwnerState({ ...base, latest: null, lastGoodDataThrough: null })).toEqual({ kind: 'awaiting_first_sync' })
  })

  it('shows synced data with its date', () => {
    expect(deriveOwnerState(base)).toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
  })

  it.each([
    ['revoked', 'reconnect'],
    ['access_lost', 'access_lost'],
    ['google_unavailable', 'retrying'],
    ['quota', 'retrying'],
    ['domain_mismatch', 'rebind'],
    ['not_entitled', 'paused_plan'],
    ['vault_error', 'temporarily_unavailable'],
  ] as const)('maps a %s run to %s, keeping the last good date', (outcome, kind) => {
    expect(deriveOwnerState({ ...base, latest: { outcome, dataThrough: null }, lastGoodDataThrough: '2026-09-18' }))
      .toEqual({ kind, dataThrough: '2026-09-18' })
  })

  it('says the plan lapsed even when the last run was fine', () => {
    expect(deriveOwnerState({ ...base, entitled: false })).toEqual({ kind: 'paused_plan', dataThrough: '2026-09-20' })
  })

  it('asks to reconnect when the connection needs it, whatever the ledger says', () => {
    expect(deriveOwnerState({ ...base, connectionStatus: 'needs_reconnect' })).toEqual({ kind: 'reconnect', dataThrough: '2026-09-20' })
  })

  it('asks to rebind when the domain changed since the last run', () => {
    expect(deriveOwnerState({ ...base, domainMatches: false })).toEqual({ kind: 'rebind', dataThrough: '2026-09-20' })
  })

  it('handles every outcome in the closed vocabulary', () => {
    for (const outcome of SYNC_OUTCOMES) {
      expect(deriveOwnerState({ ...base, latest: { outcome, dataThrough: null } }).kind).toBeTypeOf('string')
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * What the owner sees, derived and never stored (spec §5). `dataThrough` is
 * always the last date that actually synced, so a failure never renders as a
 * zero or erases the history.
 */

export const SYNC_OUTCOMES = [
  'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
  'domain_mismatch', 'not_entitled', 'vault_error',
] as const
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number]
export type ConnectionStatus = 'active' | 'needs_reconnect' | 'revoked'

type ProblemKind = 'reconnect' | 'access_lost' | 'retrying' | 'rebind' | 'paused_plan' | 'temporarily_unavailable'

export type OwnerState =
  | { kind: 'unbound' }
  | { kind: 'awaiting_first_sync' }
  | { kind: 'synced'; dataThrough: string }
  | { kind: ProblemKind; dataThrough: string | null }

export type OwnerStateInput = {
  bound: boolean
  entitled: boolean
  connectionStatus: ConnectionStatus | null
  domainMatches: boolean
  latest: { outcome: SyncOutcome; dataThrough: string | null } | null
  lastGoodDataThrough: string | null
}

const BY_OUTCOME: Record<Exclude<SyncOutcome, 'ok'>, ProblemKind> = {
  revoked: 'reconnect',
  access_lost: 'access_lost',
  google_unavailable: 'retrying',
  quota: 'retrying',
  domain_mismatch: 'rebind',
  not_entitled: 'paused_plan',
  vault_error: 'temporarily_unavailable',
}

export function deriveOwnerState(input: OwnerStateInput): OwnerState {
  if (!input.bound) return { kind: 'unbound' }
  const dataThrough = input.lastGoodDataThrough
  if (!input.entitled) return { kind: 'paused_plan', dataThrough }
  if (input.connectionStatus !== 'active') return { kind: 'reconnect', dataThrough }
  if (!input.domainMatches) return { kind: 'rebind', dataThrough }
  if (!input.latest) return dataThrough ? { kind: 'synced', dataThrough } : { kind: 'awaiting_first_sync' }
  if (input.latest.outcome === 'ok') {
    const through = input.latest.dataThrough ?? dataThrough
    return through ? { kind: 'synced', dataThrough: through } : { kind: 'awaiting_first_sync' }
  }
  return { kind: BY_OUTCOME[input.latest.outcome], dataThrough }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/search-console/state.ts __tests__/integrations/state.test.ts
git commit -m "feat(search-console): derive owner-visible state from the ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Migration 054

**Files:** Create `supabase/migrations/054_search_console.sql`. Test `__tests__/migrations/search-console-migration.test.ts`.

- [ ] **Step 1: Write the failing test** (static; the real-Postgres proof is Task 18)

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SYNC_OUTCOMES } from '@/lib/integrations/search-console/state'

const sql = readFileSync('supabase/migrations/054_search_console.sql', 'utf8')

describe('migration 054', () => {
  it.each([
    'google_connections', 'search_console_bindings', 'search_console_daily',
    'search_console_page_queries', 'search_console_sync_runs',
  ])('creates %s', table => {
    expect(sql).toMatch(new RegExp(`create table public\\.${table}\\b`))
  })

  it('uses the column-list form for every set-null actor FK', () => {
    // The plain form would also null account_id, which is NOT NULL — the 044/046 trap.
    expect(sql).toContain('on delete set null (connected_by)')
    expect(sql).toContain('on delete set null (bound_by)')
    expect(sql).not.toMatch(/on delete set null\s*[,)\n]/)
  })

  it('makes daily metrics idempotent with nulls not distinct', () => {
    expect(sql).toContain('unique nulls not distinct (client_id, scope, page_url, date)')
  })

  it('pins the ledger vocabulary to the one the code knows', () => {
    for (const outcome of SYNC_OUTCOMES) expect(sql).toContain(`'${outcome}'`)
  })

  it('grants aeo_app no DELETE on history', () => {
    for (const table of ['search_console_daily', 'search_console_page_queries', 'search_console_sync_runs']) {
      expect(sql).toMatch(new RegExp(`grant select, insert, update on public\\.${table} to aeo_app`))
    }
  })

  it('creates no RLS policy (036)', () => {
    expect(sql).not.toMatch(/create policy/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run __tests__/migrations/search-console-migration.test.ts` → FAIL, file not found.

- [ ] **Step 3: Write the migration**

```sql
-- 054: Google connection + Search Console connector (Phase 2, sub-project 1).
-- Spec: docs/superpowers/specs/2026-09-24-search-console-connector-design.md
--
-- Tenancy is carried by composite foreign keys, per 041-046: a binding can never
-- pair one account's brand with another account's connection, because the
-- database refuses it. No RLS (036); every query filters by account.

create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  google_subject text not null,
  google_email text,
  scopes text[] not null,
  -- AES-256-GCM output from lib/integrations/google/vault.ts. Null once revoked:
  -- disconnecting deletes the credential, not the row explaining the history.
  token_ciphertext bytea,
  token_key_id text,
  status text not null default 'active',
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, google_subject),
  unique (id, account_id),
  constraint google_connections_status_check
    check (status in ('active', 'needs_reconnect', 'revoked')),
  -- A usable connection has a credential; a revoked one has none.
  constraint google_connections_token_check check ((
    (status = 'revoked' and token_ciphertext is null and token_key_id is null)
    or (status <> 'revoked' and token_ciphertext is not null and token_key_id is not null)
  ) is true),
  -- Provenance, so erasable. Column-list form: plain `set null` would also null
  -- account_id, which is NOT NULL — the 044/046 trap. 053 uses the same form.
  constraint google_connections_connected_by_fk
    foreign key (connected_by, account_id) references public.profiles (id, account_id)
    on delete set null (connected_by)
);

create table public.search_console_bindings (
  account_id uuid not null,
  client_id uuid not null,
  connection_id uuid not null,
  site_url text not null,
  permission_level text not null,
  -- The brand's domain when bound. If clients.domain changes the binding reads
  -- as mismatched and stops syncing — domain verification's (053) behaviour.
  bound_domain text not null,
  backfill_pending boolean not null default true,
  bound_by uuid,
  bound_at timestamptz not null default now(),
  primary key (account_id, client_id),
  constraint search_console_bindings_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_bindings_connection_fk
    foreign key (connection_id, account_id) references public.google_connections (id, account_id) on delete cascade,
  constraint search_console_bindings_bound_by_fk
    foreign key (bound_by, account_id) references public.profiles (id, account_id)
    on delete set null (bound_by)
);

create table public.search_console_daily (
  account_id uuid not null,
  client_id uuid not null,
  date date not null,
  scope text not null,
  page_url text,
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  ctr double precision not null check (ctr >= 0 and ctr <= 1),
  position double precision not null check (position >= 0),
  synced_at timestamptz not null default now(),
  constraint search_console_daily_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_daily_scope_check check ((
    (scope = 'property' and page_url is null) or (scope = 'page' and page_url is not null)
  ) is true),
  -- NULLS NOT DISTINCT (PostgreSQL 15+): property rows share a null page_url, and
  -- a plain unique would let a re-sync insert them twice — pulse_metrics' defect.
  constraint search_console_daily_unique
    unique nulls not distinct (client_id, scope, page_url, date)
);

create table public.search_console_page_queries (
  account_id uuid not null,
  client_id uuid not null,
  page_url text not null,
  date date not null,
  query text not null,
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  ctr double precision not null check (ctr >= 0 and ctr <= 1),
  position double precision not null check (position >= 0),
  constraint search_console_page_queries_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_page_queries_unique unique (client_id, page_url, date, query)
);

create table public.search_console_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  ran_at timestamptz not null default now(),
  outcome text not null,
  rows_written integer not null default 0 check (rows_written >= 0),
  data_through date,
  constraint search_console_sync_runs_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  -- Closed vocabulary, mirrored by SYNC_OUTCOMES in lib/integrations/search-console/state.ts.
  constraint search_console_sync_runs_outcome_check check (outcome in (
    'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
    'domain_mismatch', 'not_entitled', 'vault_error'
  ))
);

create index search_console_sync_runs_latest_idx
  on public.search_console_sync_runs (account_id, client_id, ran_at desc);
create index search_console_daily_read_idx
  on public.search_console_daily (account_id, client_id, date desc);

revoke all on public.google_connections, public.search_console_bindings, public.search_console_daily,
  public.search_console_page_queries, public.search_console_sync_runs from public;

do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.google_connections, public.search_console_bindings, public.search_console_daily,
      public.search_console_page_queries, public.search_console_sync_runs from aeo_app;
    -- Bindings are configuration: unbinding and revoking delete them.
    grant select, insert, update, delete on public.search_console_bindings to aeo_app;
    grant select, insert, update on public.google_connections to aeo_app;
    -- History: no DELETE. Disconnecting removes the credential, not the record.
    grant select, insert, update on public.search_console_daily to aeo_app;
    grant select, insert, update on public.search_console_page_queries to aeo_app;
    grant select, insert, update on public.search_console_sync_runs to aeo_app;
  end if;
end $$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/migrations/` → PASS (includes `rls-policy-freeze.test.mjs`).
Run: `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration` → PASS. The harness replays every migration including `054` on a disposable branch, which proves the SQL applies. If `__tests__/integration/migrate.test.ts` pins the number of migrations, raise it by one; the five new tables are deliberately **not** RLS-enabled, so its RLS-set assertion must not change.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/054_search_console.sql __tests__/migrations/search-console-migration.test.ts
git commit -m "feat(search-console): migration 054 — connections, bindings, metrics, ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Store

**Files:** Create `lib/integrations/search-console/store.ts`. Modify `__tests__/security/tenancy-inventory.test.ts` (`TENANT_TABLES`). Behaviour is proven against real Postgres in Task 18.

- [ ] **Step 1: Register the tables** — add to `TENANT_TABLES`, under "Direct `account_id` column":

```ts
  google_connections: 'account_id (054)',
  search_console_bindings: 'account_id (054)',
  search_console_daily: 'account_id (054)',
  search_console_page_queries: 'account_id (054)',
  search_console_sync_runs: 'account_id (054)',
```

- [ ] **Step 2: Run** — `npx vitest run __tests__/security/tenancy-inventory.test.ts` → PASS (nothing touches the tables yet). It guards Step 3.

- [ ] **Step 3: Implement**

```ts
import 'server-only'
import { db } from '@/lib/db'
import type { CommercialAccount } from '@/lib/tier'
import type { SealedToken } from '@/lib/integrations/google/vault'
import type { ConnectionStatus, SyncOutcome } from './state'
import type { AnalyticsRow } from './client'

/**
 * All SQL for the Search Console connector. Tenancy is inside every statement:
 * each names account_id, so a caller cannot address another account's row by
 * passing its id. Zero rows means "absent or not yours"; callers answer 404
 * without distinguishing them. Named `returning` columns only.
 */

export type ConnectionSummary = {
  id: string
  googleEmail: string | null
  status: ConnectionStatus
  scopes: string[]
  createdAt: string
}

export type BindingRow = {
  connectionId: string
  siteUrl: string
  permissionLevel: string
  boundDomain: string
  backfillPending: boolean
  connectionStatus: ConnectionStatus
  currentDomain: string | null
}

export type DueBinding = {
  accountId: string
  clientId: string
  connectionId: string
  siteUrl: string
  boundDomain: string
  currentDomain: string | null
  backfillPending: boolean
  account: CommercialAccount
}

export type DailyMetric = {
  date: string
  scope: 'property' | 'page'
  pageUrl: string | null
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type PageQueryMetric = { pageUrl: string; date: string; query: string } & Omit<AnalyticsRow, 'keys'>

export type MetricTotals = Pick<DailyMetric, 'clicks' | 'impressions' | 'ctr' | 'position'>

export type PanelData = {
  latest: { outcome: SyncOutcome; dataThrough: string | null } | null
  lastGoodDataThrough: string | null
  property: MetricTotals | null
  pages: Array<{ pageUrl: string } & MetricTotals>
}

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value))

export async function upsertConnection(input: {
  accountId: string
  profileId: string
  subject: string
  email: string | null
  scopes: string[]
  sealed: SealedToken
}): Promise<string> {
  const sql = db()
  const rows = await sql`
    insert into google_connections
      (account_id, google_subject, google_email, scopes, token_ciphertext, token_key_id, status, connected_by)
    values (${input.accountId}, ${input.subject}, ${input.email}, ${input.scopes}::text[],
            ${input.sealed.ciphertext}, ${input.sealed.keyId}, 'active', ${input.profileId})
    on conflict (account_id, google_subject) do update set
      google_email = excluded.google_email,
      scopes = excluded.scopes,
      token_ciphertext = excluded.token_ciphertext,
      token_key_id = excluded.token_key_id,
      status = 'active',
      updated_at = now()
    returning id
  `
  const id = rows[0]?.id
  if (typeof id !== 'string') throw new Error('google_connections upsert returned no row')
  return id
}

export async function listConnections(accountId: string): Promise<ConnectionSummary[]> {
  const sql = db()
  const rows = await sql`
    select id, google_email, status, scopes, created_at
    from google_connections
    where account_id = ${accountId}
    order by created_at, id
  `
  return rows.map(r => ({
    id: String(r.id),
    googleEmail: (r.google_email as string | null) ?? null,
    status: r.status as ConnectionStatus,
    scopes: (r.scopes as string[] | null) ?? [],
    createdAt: iso(r.created_at),
  }))
}

export async function loadConnectionSecret(
  accountId: string,
  connectionId: string,
): Promise<{ status: ConnectionStatus; sealed: SealedToken | null } | null> {
  const sql = db()
  const rows = await sql`
    select status, token_ciphertext, token_key_id
    from google_connections
    where account_id = ${accountId} and id = ${connectionId}
    limit 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    status: row.status as ConnectionStatus,
    sealed: row.token_ciphertext && row.token_key_id
      ? { ciphertext: Buffer.from(row.token_ciphertext as Uint8Array), keyId: String(row.token_key_id) }
      : null,
  }
}

export async function markConnection(accountId: string, connectionId: string, status: 'needs_reconnect'): Promise<void> {
  const sql = db()
  await sql`
    update google_connections set status = ${status}, updated_at = now()
    where account_id = ${accountId} and id = ${connectionId} and status = 'active'
  `
}

/** Unbinds every brand on the connection and deletes the credential, atomically. */
export async function revokeConnectionRow(accountId: string, connectionId: string): Promise<boolean> {
  const sql = db()
  const [, revoked] = await sql.transaction([
    sql`delete from search_console_bindings where account_id = ${accountId} and connection_id = ${connectionId}`,
    sql`
      update google_connections
      set status = 'revoked', token_ciphertext = null, token_key_id = null, updated_at = now()
      where account_id = ${accountId} and id = ${connectionId}
      returning id
    `,
  ])
  return (revoked as unknown[]).length > 0
}

/**
 * One statement: the brand and the connection are both constrained to the
 * account inside it, and the connection must be active. False means one of them
 * is absent, not this account's, or unusable.
 */
export async function bindProperty(input: {
  accountId: string
  clientId: string
  connectionId: string
  siteUrl: string
  permissionLevel: string
  boundDomain: string
  profileId: string
}): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    insert into search_console_bindings
      (account_id, client_id, connection_id, site_url, permission_level, bound_domain, backfill_pending, bound_by)
    select c.account_id, c.id, g.id, ${input.siteUrl}, ${input.permissionLevel}, ${input.boundDomain}, true, ${input.profileId}
    from clients c
    join google_connections g on g.id = ${input.connectionId} and g.account_id = c.account_id and g.status = 'active'
    where c.id = ${input.clientId} and c.account_id = ${input.accountId}
    on conflict (account_id, client_id) do update set
      connection_id = excluded.connection_id,
      site_url = excluded.site_url,
      permission_level = excluded.permission_level,
      bound_domain = excluded.bound_domain,
      backfill_pending = true,
      bound_by = excluded.bound_by,
      bound_at = now()
    returning client_id
  `
  return rows.length > 0
}

export async function unbindProperty(accountId: string, clientId: string): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    delete from search_console_bindings
    where account_id = ${accountId} and client_id = ${clientId}
    returning client_id
  `
  return rows.length > 0
}

export async function loadBinding(accountId: string, clientId: string): Promise<BindingRow | null> {
  const sql = db()
  const rows = await sql`
    select b.connection_id, b.site_url, b.permission_level, b.bound_domain, b.backfill_pending,
           g.status as connection_status, c.domain as current_domain
    from search_console_bindings b
    join google_connections g on g.id = b.connection_id and g.account_id = b.account_id
    join clients c on c.id = b.client_id and c.account_id = b.account_id
    where b.account_id = ${accountId} and b.client_id = ${clientId}
    limit 1
  `
  const r = rows[0]
  if (!r) return null
  return {
    connectionId: String(r.connection_id),
    siteUrl: String(r.site_url),
    permissionLevel: String(r.permission_level),
    boundDomain: String(r.bound_domain),
    backfillPending: Boolean(r.backfill_pending),
    connectionStatus: r.connection_status as ConnectionStatus,
    currentDomain: (r.current_domain as string | null) ?? null,
  }
}

/**
 * The cron's selection and the one account-blind statement here, by design, like
 * alert evaluation. Each row carries its own account_id and every write the sync
 * makes uses that value. Anything synced in the last 20 hours is not due, and
 * the rest go oldest-synced first so a budget-limited run never starves a brand.
 */
export async function loadDueBindings(limit: number): Promise<DueBinding[]> {
  const sql = db()
  const rows = await sql`
    select b.account_id, b.client_id, b.connection_id, b.site_url, b.bound_domain, b.backfill_pending,
           c.domain as current_domain, to_jsonb(a) as account, last_run.ran_at as last_ran
    from search_console_bindings b
    join google_connections g on g.id = b.connection_id and g.account_id = b.account_id
    join clients c on c.id = b.client_id and c.account_id = b.account_id
    join accounts a on a.id = b.account_id
    left join lateral (
      select max(r.ran_at) as ran_at from search_console_sync_runs r
      where r.account_id = b.account_id and r.client_id = b.client_id
    ) last_run on true
    where g.status = 'active'
      and (last_run.ran_at is null or last_run.ran_at < now() - interval '20 hours')
    order by last_run.ran_at asc nulls first, b.client_id
    limit ${limit}
  `
  return rows.map(r => ({
    accountId: String(r.account_id),
    clientId: String(r.client_id),
    connectionId: String(r.connection_id),
    siteUrl: String(r.site_url),
    boundDomain: String(r.bound_domain),
    currentDomain: (r.current_domain as string | null) ?? null,
    backfillPending: Boolean(r.backfill_pending),
    account: r.account as CommercialAccount,
  }))
}

/** Oldest-registered first, capped (spec §4.3). */
export async function listSyncPages(accountId: string, clientId: string, cap: number): Promise<string[]> {
  const sql = db()
  const rows = await sql`
    select url from client_assets
    where account_id = ${accountId} and client_id = ${clientId}
    order by created_at, id
    limit ${cap}
  `
  return rows.map(r => String(r.url))
}

export async function writeDaily(accountId: string, clientId: string, metrics: DailyMetric[]): Promise<number> {
  if (!metrics.length) return 0
  const sql = db()
  const rows = await sql`
    insert into search_console_daily
      (account_id, client_id, date, scope, page_url, clicks, impressions, ctr, position)
    select ${accountId}, ${clientId}, d::date, s, p, cl, im, ct, po
    from unnest(
      ${metrics.map(m => m.date)}::text[], ${metrics.map(m => m.scope)}::text[],
      ${metrics.map(m => m.pageUrl)}::text[], ${metrics.map(m => m.clicks)}::int[],
      ${metrics.map(m => m.impressions)}::int[], ${metrics.map(m => m.ctr)}::float8[],
      ${metrics.map(m => m.position)}::float8[]
    ) as t(d, s, p, cl, im, ct, po)
    on conflict on constraint search_console_daily_unique do update set
      clicks = excluded.clicks, impressions = excluded.impressions,
      ctr = excluded.ctr, position = excluded.position, synced_at = now()
    returning 1
  `
  return rows.length
}

export async function writePageQueries(accountId: string, clientId: string, metrics: PageQueryMetric[]): Promise<number> {
  if (!metrics.length) return 0
  const sql = db()
  const rows = await sql`
    insert into search_console_page_queries
      (account_id, client_id, page_url, date, query, clicks, impressions, ctr, position)
    select ${accountId}, ${clientId}, p, d::date, q, cl, im, ct, po
    from unnest(
      ${metrics.map(m => m.pageUrl)}::text[], ${metrics.map(m => m.date)}::text[],
      ${metrics.map(m => m.query)}::text[], ${metrics.map(m => m.clicks)}::int[],
      ${metrics.map(m => m.impressions)}::int[], ${metrics.map(m => m.ctr)}::float8[],
      ${metrics.map(m => m.position)}::float8[]
    ) as t(p, d, q, cl, im, ct, po)
    on conflict on constraint search_console_page_queries_unique do update set
      clicks = excluded.clicks, impressions = excluded.impressions,
      ctr = excluded.ctr, position = excluded.position
    returning 1
  `
  return rows.length
}

export async function recordRun(input: {
  accountId: string
  clientId: string
  outcome: SyncOutcome
  rowsWritten: number
  dataThrough: string | null
  clearBackfill: boolean
}): Promise<void> {
  const sql = db()
  await sql.transaction([
    sql`
      insert into search_console_sync_runs (account_id, client_id, outcome, rows_written, data_through)
      values (${input.accountId}, ${input.clientId}, ${input.outcome}, ${input.rowsWritten}, ${input.dataThrough}::date)
    `,
    sql`
      update search_console_bindings set backfill_pending = false
      where account_id = ${input.accountId} and client_id = ${input.clientId} and ${input.clearBackfill}::boolean
    `,
  ])
}

/**
 * 28-day totals ending at the newest stored date. CTR and position are
 * impression-weighted: a day with 3 impressions must not count as much as a day
 * with 3,000.
 */
export async function loadPanelData(accountId: string, clientId: string): Promise<PanelData> {
  const sql = db()
  const [runs, lastGood, totals] = await sql.transaction([
    sql`
      select outcome, data_through::text as data_through
      from search_console_sync_runs
      where account_id = ${accountId} and client_id = ${clientId}
      order by ran_at desc
      limit 1
    `,
    sql`
      select max(data_through)::text as last_good
      from search_console_sync_runs
      where account_id = ${accountId} and client_id = ${clientId} and outcome = 'ok'
    `,
    sql`
      select scope, page_url,
             sum(clicks)::int as clicks, sum(impressions)::int as impressions,
             case when sum(impressions) = 0 then 0 else sum(clicks)::float8 / sum(impressions) end as ctr,
             case when sum(impressions) = 0 then 0 else sum(position * impressions) / sum(impressions) end as position
      from search_console_daily
      where account_id = ${accountId} and client_id = ${clientId}
        and date > (
          select coalesce(max(date), current_date) from search_console_daily
          where account_id = ${accountId} and client_id = ${clientId}
        ) - 28
      group by scope, page_url
      order by scope, page_url
    `,
  ])
  const run = (runs as Array<Record<string, unknown>>)[0]
  const all = totals as Array<Record<string, unknown>>
  const metric = (r: Record<string, unknown>): MetricTotals => ({
    clicks: Number(r.clicks), impressions: Number(r.impressions), ctr: Number(r.ctr), position: Number(r.position),
  })
  const property = all.find(r => r.scope === 'property')
  return {
    latest: run ? { outcome: run.outcome as SyncOutcome, dataThrough: (run.data_through as string | null) ?? null } : null,
    lastGoodDataThrough: ((lastGood as Array<Record<string, unknown>>)[0]?.last_good as string | null) ?? null,
    property: property ? metric(property) : null,
    pages: all.filter(r => r.scope === 'page').map(r => ({ pageUrl: String(r.page_url), ...metric(r) })),
  }
}
```

- [ ] **Step 4: Run the inventory and typecheck**

Run: `npx vitest run __tests__/security/tenancy-inventory.test.ts` → PASS. Every statement names `account_id`, which `OWNERSHIP_TOKENS` counts as scoped.
If it instead lists `lib/integrations/search-console/store.ts::loadDueBindings`, add this to `DECLARED` and change `EXPECTED_UNSCOPED_TOTAL` from `17` to `18`:

```ts
  'lib/integrations/search-console/store.ts::loadDueBindings':
    'The Search Console cron selection: one bounded pass over every account\'s active bindings, run by ' +
    'cron/search-console, cross-account by definition like alert evaluation. Each row carries its own ' +
    'account_id and every write the sync makes uses that value, never a caller\'s.',
```

Run: `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/search-console/store.ts __tests__/security/tenancy-inventory.test.ts
git commit -m "feat(search-console): store with tenancy inside every statement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Guard

**Files:** Create `lib/integrations/search-console/guard.ts`. Test `__tests__/integrations/guard.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const verifyClientOwnership = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/localTrust/store', () => ({ verifyClientOwnership }))

import { authorizeSearchConsole } from '@/lib/integrations/search-console/guard'

const pro = { id: 'p', account_id: 'a', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const status = async (clientId = 'c') => {
  const r = await authorizeSearchConsole(clientId)
  return r.ok ? 200 : r.response.status
}

describe('authorizeSearchConsole', () => {
  beforeEach(() => {
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    getProfile.mockReset()
    verifyClientOwnership.mockReset()
  })

  it('is a plain 404 when the flag is off, before touching the session', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    expect(await status()).toBe(404)
    expect(getProfile).not.toHaveBeenCalled()
  })

  it('is 401 when signed out', async () => {
    getProfile.mockResolvedValue(null)
    expect(await status()).toBe(401)
  })

  it('is 403 below Pro, before any ownership lookup', async () => {
    getProfile.mockResolvedValue({ ...pro, accounts: { ...pro.accounts, plan: 'basic' } })
    expect(await status()).toBe(403)
    expect(verifyClientOwnership).not.toHaveBeenCalled()
  })

  it('is 404 for a brand that is not the account\'s', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockResolvedValue(null)
    expect(await status()).toBe(404)
  })

  it('is 503 when the ownership lookup fails, never 404', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockRejectedValue(new Error('db'))
    expect(await status()).toBe(503)
  })

  it('passes with the account from the session, never a caller id', async () => {
    getProfile.mockResolvedValue(pro)
    verifyClientOwnership.mockResolvedValue({ id: 'c', domain: 'example.com' })
    expect(await status('c')).toBe(200)
    expect(verifyClientOwnership).toHaveBeenCalledWith('c', 'a')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { getProfile } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { verifyClientOwnership } from '@/lib/localTrust/store'
import type { Client, ProfileWithAccount } from '@/lib/types'

/**
 * flag → auth → entitlement → ownership, in one place (spec §6), copying
 * lib/localTrust/guard.ts. The flag comes first so a switched-off feature is a
 * plain 404 to everyone and reveals nothing about plans or brands.
 */

type Denied = { ok: false; response: Response }

const deny = (status: number, error: string): Denied =>
  ({ ok: false, response: Response.json({ error }, { status }) })

/** The session-only half, for routes with no brand in the URL. */
export async function authorizeSearchConsoleAccount(): Promise<{ ok: true; profile: ProfileWithAccount } | Denied> {
  if (!isFeatureEnabled('search_console')) return deny(404, 'Not found')
  // Deliberately not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return deny(401, 'Unauthorized')
  if (!resolveCommercialEntitlement(profile.accounts).features.search_console) return deny(403, 'UPGRADE_REQUIRED')
  return { ok: true, profile }
}

export async function authorizeSearchConsole(
  clientId: string,
): Promise<{ ok: true; profile: ProfileWithAccount; client: Client } | Denied> {
  const account = await authorizeSearchConsoleAccount()
  if (!account.ok) return account
  let client: Client | null
  try {
    client = await verifyClientOwnership(clientId, account.profile.account_id)
  } catch {
    // Never let a failed lookup read as "not yours".
    return deny(503, 'Lookup failed')
  }
  if (!client) return deny(404, 'Not found')
  return { ok: true, profile: account.profile, client }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/search-console/guard.ts __tests__/integrations/guard.test.ts
git commit -m "feat(search-console): flag, auth, entitlement and ownership guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Sync one binding

**Files:** Create `lib/integrations/search-console/sync.ts`. Test `__tests__/integrations/sync.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { VaultError } from '@/lib/integrations/google/vault'
import { syncBinding, type SyncDeps } from '@/lib/integrations/search-console/sync'
import type { DueBinding } from '@/lib/integrations/search-console/store'

const binding = (over: Partial<DueBinding> = {}): DueBinding => ({
  accountId: 'a', clientId: 'c', connectionId: 'g', siteUrl: 'sc-domain:example.com',
  boundDomain: 'example.com', currentDomain: 'example.com', backfillPending: false,
  account: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } as DueBinding['account'],
  ...over,
})

function deps(over: Partial<SyncDeps> = {}): SyncDeps {
  return {
    loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } }),
    open: vi.fn().mockReturnValue('1//refresh'),
    refresh: vi.fn().mockResolvedValue('ya29.access'),
    query: vi.fn().mockResolvedValue([]),
    listPages: vi.fn().mockResolvedValue([]),
    writeDaily: vi.fn().mockResolvedValue(0),
    writePageQueries: vi.fn().mockResolvedValue(0),
    markConnection: vi.fn().mockResolvedValue(undefined),
    recordRun: vi.fn().mockResolvedValue(undefined),
    today: () => '2026-09-24',
    ...over,
  }
}

describe('syncBinding', () => {
  it('skips an account below Pro without calling Google, and records it', async () => {
    const d = deps()
    expect(await syncBinding(binding({ account: { plan: 'basic', status: 'active' } as DueBinding['account'] }), d))
      .toBe('not_entitled')
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'not_entitled', clearBackfill: false }))
  })

  it('skips a binding whose brand domain changed', async () => {
    const d = deps()
    expect(await syncBinding(binding({ currentDomain: 'other.com' }), d)).toBe('domain_mismatch')
    expect(d.refresh).not.toHaveBeenCalled()
  })

  it('reports a vault failure as ours, not as a revoked login', async () => {
    const d = deps({ open: vi.fn(() => { throw new VaultError('VAULT_KEY_UNKNOWN') }) })
    expect(await syncBinding(binding(), d)).toBe('vault_error')
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('marks the connection for reconnect when the refresh token is dead', async () => {
    const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('revoked', 400)) })
    expect(await syncBinding(binding(), d)).toBe('revoked')
    expect(d.markConnection).toHaveBeenCalledWith('a', 'g', 'needs_reconnect')
  })

  it.each([
    ['forbidden', 'access_lost'],
    ['quota', 'quota'],
    ['unavailable', 'google_unavailable'],
  ] as const)('maps a %s query failure to %s and leaves the connection alone', async (kind, outcome) => {
    const d = deps({ query: vi.fn().mockRejectedValue(new GoogleApiError(kind, 0)) })
    expect(await syncBinding(binding(), d)).toBe(outcome)
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('fetches 90 days on backfill and 7 days otherwise', async () => {
    const first = deps()
    await syncBinding(binding({ backfillPending: true }), first)
    expect(first.query).toHaveBeenCalledWith('ya29.access', 'sc-domain:example.com',
      expect.objectContaining({ startDate: '2026-06-27', endDate: '2026-09-24', dimensions: ['date'] }))

    const routine = deps()
    await syncBinding(binding(), routine)
    expect(routine.query).toHaveBeenCalledWith('ya29.access', 'sc-domain:example.com',
      expect.objectContaining({ startDate: '2026-09-18', endDate: '2026-09-24' }))
  })

  it('writes property and page totals, keeps the top 25 queries per date, and records ok', async () => {
    const queryRows = Array.from({ length: 30 }, (_, i) =>
      ({ keys: ['2026-09-20', `q${i}`], clicks: 30 - i, impressions: 100, ctr: 0.1, position: 5 }))
    const query = vi.fn()
      .mockResolvedValueOnce([{ keys: ['2026-09-20'], clicks: 10, impressions: 200, ctr: 0.05, position: 7 }])
      .mockResolvedValueOnce([{ keys: ['2026-09-20'], clicks: 4, impressions: 50, ctr: 0.08, position: 3 }])
      .mockResolvedValueOnce(queryRows)
    const d = deps({ query, listPages: vi.fn().mockResolvedValue(['https://example.com/p']) })

    expect(await syncBinding(binding({ backfillPending: true }), d)).toBe('ok')

    expect(d.writeDaily).toHaveBeenCalledWith('a', 'c', [
      { date: '2026-09-20', scope: 'property', pageUrl: null, clicks: 10, impressions: 200, ctr: 0.05, position: 7 },
      { date: '2026-09-20', scope: 'page', pageUrl: 'https://example.com/p', clicks: 4, impressions: 50, ctr: 0.08, position: 3 },
    ])
    const written = vi.mocked(d.writePageQueries).mock.calls[0]![2]
    expect(written).toHaveLength(25)
    expect(written[0]!.query).toBe('q0')
    expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'ok', dataThrough: '2026-09-20', clearBackfill: true,
    }))
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { resolveCommercialEntitlement } from '@/lib/tier'
import { GoogleApiError, type GoogleFailure } from '@/lib/integrations/google/oauth'
import { VaultError, type SealedToken } from '@/lib/integrations/google/vault'
import type { AnalyticsQuery, AnalyticsRow } from './client'
import { normalizeBrandDomain } from './binding'
import type { SyncOutcome } from './state'
import type { DailyMetric, DueBinding, PageQueryMetric } from './store'

/**
 * Sync one binding and say exactly what happened (spec §4.3, §5). Every
 * dependency is injected, so the whole decision table is unit-tested with no
 * Google and no database. A ledger row is written for every outcome, skips
 * included — the owner's screen is derived from it.
 */

export const BACKFILL_DAYS = 90
export const ROUTINE_DAYS = 7
export const PAGE_CAP = 20
export const QUERY_CAP = 25

export type SyncDeps = {
  loadSecret(accountId: string, connectionId: string): Promise<{ status: string; sealed: SealedToken | null } | null>
  /** Opens the sealed refresh token; the vault binds each ciphertext to its account. */
  open(sealed: SealedToken, accountId: string): string
  refresh(refreshToken: string): Promise<string>
  query(accessToken: string, siteUrl: string, q: AnalyticsQuery): Promise<AnalyticsRow[]>
  listPages(accountId: string, clientId: string, cap: number): Promise<string[]>
  writeDaily(accountId: string, clientId: string, metrics: DailyMetric[]): Promise<number>
  writePageQueries(accountId: string, clientId: string, metrics: PageQueryMetric[]): Promise<number>
  markConnection(accountId: string, connectionId: string, status: 'needs_reconnect'): Promise<void>
  recordRun(input: {
    accountId: string
    clientId: string
    outcome: SyncOutcome
    rowsWritten: number
    dataThrough: string | null
    clearBackfill: boolean
  }): Promise<void>
  today(): string
}

const OUTCOME_FOR: Record<GoogleFailure, SyncOutcome> = {
  revoked: 'revoked',
  forbidden: 'access_lost',
  quota: 'quota',
  unavailable: 'google_unavailable',
}

function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function topQueriesPerDate(pageUrl: string, rows: AnalyticsRow[]): PageQueryMetric[] {
  const byDate = new Map<string, AnalyticsRow[]>()
  for (const row of rows) {
    const [date, query] = row.keys
    if (!date || !query) continue
    byDate.set(date, [...(byDate.get(date) ?? []), row])
  }
  return [...byDate.entries()].flatMap(([date, list]) => list
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, QUERY_CAP)
    .map(r => ({
      pageUrl, date, query: r.keys[1]!, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    })))
}

export async function syncBinding(b: DueBinding, deps: SyncDeps): Promise<SyncOutcome> {
  const finish = async (outcome: SyncOutcome, rowsWritten = 0, dataThrough: string | null = null) => {
    await deps.recordRun({
      accountId: b.accountId, clientId: b.clientId, outcome, rowsWritten, dataThrough, clearBackfill: outcome === 'ok',
    })
    return outcome
  }

  if (!resolveCommercialEntitlement(b.account).features.search_console) return finish('not_entitled')
  if (normalizeBrandDomain(b.currentDomain) !== normalizeBrandDomain(b.boundDomain)) return finish('domain_mismatch')

  const secret = await deps.loadSecret(b.accountId, b.connectionId)
  if (!secret || secret.status !== 'active' || !secret.sealed) return finish('revoked')

  let refreshToken: string
  try {
    refreshToken = deps.open(secret.sealed, b.accountId)
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[search-console] vault failure', { clientId: b.clientId, code: error.code })
    return finish('vault_error')
  }

  const endDate = deps.today()
  const startDate = daysBefore(endDate, (b.backfillPending ? BACKFILL_DAYS : ROUTINE_DAYS) - 1)

  try {
    const accessToken = await deps.refresh(refreshToken)
    const property = await deps.query(accessToken, b.siteUrl, { startDate, endDate, dimensions: ['date'] })
    const daily: DailyMetric[] = property.map(r => ({
      date: r.keys[0]!, scope: 'property' as const, pageUrl: null,
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }))

    const queries: PageQueryMetric[] = []
    for (const pageUrl of await deps.listPages(b.accountId, b.clientId, PAGE_CAP)) {
      const pageRows = await deps.query(accessToken, b.siteUrl, { startDate, endDate, dimensions: ['date'], pageEquals: pageUrl })
      daily.push(...pageRows.map(r => ({
        date: r.keys[0]!, scope: 'page' as const, pageUrl,
        clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
      })))
      // One request per page with date + query; the top QUERY_CAP per date are kept
      // locally. One request per day would cost 90 per page on a backfill.
      queries.push(...topQueriesPerDate(pageUrl,
        await deps.query(accessToken, b.siteUrl, { startDate, endDate, dimensions: ['date', 'query'], pageEquals: pageUrl })))
    }

    const written = await deps.writeDaily(b.accountId, b.clientId, daily)
      + await deps.writePageQueries(b.accountId, b.clientId, queries)
    const dataThrough = property.map(r => r.keys[0]!).sort().at(-1) ?? null
    return finish('ok', written, dataThrough)
  } catch (error) {
    if (!(error instanceof GoogleApiError)) throw error
    if (error.kind === 'revoked') await deps.markConnection(b.accountId, b.connectionId, 'needs_reconnect')
    return finish(OUTCOME_FOR[error.kind])
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/search-console/sync.ts __tests__/integrations/sync.test.ts
git commit -m "feat(search-console): sync one binding into a named ledger outcome

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Consent routes

**Files:** Create `lib/integrations/google/consent-reasons.ts`, `app/api/integrations/google/start/route.ts`, `app/api/integrations/google/callback/route.ts`. Test `__tests__/api/search-console-consent.test.ts`.

The refusal reasons live in their own dependency-free module because two places need them: the callback route writes them and the settings panel (a client component) translates them. `consent-state.ts` imports `node:crypto`, so the panel must not import from it.

- [ ] **Step 1: Write the failing test**

```ts
import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GOOGLE_CONSENT_COOKIE, signConsentState } from '@/lib/integrations/google/consent-state'
import { SEARCH_CONSOLE_SCOPE } from '@/lib/integrations/google/oauth'

const getProfile = vi.hoisted(() => vi.fn())
const upsertConnection = vi.hoisted(() => vi.fn())
const exchangeCode = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/integrations/search-console/store', () => ({ upsertConnection }))
vi.mock('@/lib/integrations/google/oauth', async importOriginal => ({ ...(await importOriginal<object>()), exchangeCode }))

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  account_id: '22222222-2222-4222-8222-222222222222',
  accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' },
}

beforeEach(() => {
  Object.assign(process.env, {
    FEATURE_SEARCH_CONSOLE: '1', GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'cs',
    GOOGLE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    REPORT_SHARE_SECRET: 'consent-route-test-secret-0123456789abcdef',
    NEXT_PUBLIC_APP_URL: 'https://app.test',
  })
  getProfile.mockReset().mockResolvedValue(profile)
  upsertConnection.mockReset().mockResolvedValue('conn-1')
  exchangeCode.mockReset()
})

describe('GET start', () => {
  const start = async (query = '') => {
    const { GET } = await import('@/app/api/integrations/google/start/route')
    return GET(new NextRequest(`https://app.test/api/integrations/google/start${query}`))
  }

  it('redirects to Google and sets a signed, HttpOnly, Lax consent cookie', async () => {
    const res = await start('?return=/en/dashboard/settings')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\//)
    const cookie = res.cookies.get(GOOGLE_CONSENT_COOKIE)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
  })

  it('refuses before redirecting when the encryption key is missing', async () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect((await start()).status).toBe(500)
  })

  it('is 404 with the flag off', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    expect((await start()).status).toBe(404)
  })
})

describe('GET callback', () => {
  const STATE = 's'.repeat(43)
  const cookieFor = (over: Partial<Parameters<typeof signConsentState>[0]> = {}) => signConsentState({
    state: STATE, verifier: 'v'.repeat(64), profileId: profile.id, accountId: profile.account_id,
    returnPath: '/en/dashboard/settings', ...over,
  })
  const callback = async (cookie: string | null, query = `code=c&state=${STATE}`) => {
    const { GET } = await import('@/app/api/integrations/google/callback/route')
    return GET(new NextRequest(`https://app.test/api/integrations/google/callback?${query}`, {
      headers: cookie ? { cookie: `${GOOGLE_CONSENT_COOKIE}=${cookie}` } : {},
    }))
  }
  const grant = (over = {}) => ({
    accessToken: 'ya29.x', refreshToken: '1//r', subject: 'g-1', email: 'o@example.com',
    scopes: ['openid', 'email', SEARCH_CONSOLE_SCOPE], ...over,
  })

  it('stores an encrypted connection and returns to settings', async () => {
    exchangeCode.mockResolvedValue(grant())
    const res = await callback(cookieFor())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://app.test/en/dashboard/settings?google=connected')
    const stored = upsertConnection.mock.calls[0]![0]
    expect(stored.accountId).toBe(profile.account_id)
    expect(stored.sealed.ciphertext.includes(Buffer.from('1//r'))).toBe(false)
  })

  it('refuses a missing cookie without exchanging the code', async () => {
    expect((await callback(null)).headers.get('location')).toContain('reason=consent_invalid')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses a state mismatch without exchanging the code', async () => {
    expect((await callback(cookieFor(), `code=c&state=${'t'.repeat(43)}`)).headers.get('location'))
      .toContain('reason=consent_invalid')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses a cookie started by a different person', async () => {
    expect((await callback(cookieFor({ profileId: '33333333-3333-4333-8333-333333333333' }))).headers.get('location'))
      .toContain('reason=session_mismatch')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses a grant without a refresh token', async () => {
    exchangeCode.mockResolvedValue(grant({ refreshToken: null }))
    expect((await callback(cookieFor())).headers.get('location')).toContain('reason=no_refresh_token')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('refuses a grant without the Search Console scope', async () => {
    exchangeCode.mockResolvedValue(grant({ scopes: ['openid', 'email'] }))
    expect((await callback(cookieFor())).headers.get('location')).toContain('reason=scope_missing')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('never reports connected over a failed write', async () => {
    exchangeCode.mockResolvedValue(grant())
    upsertConnection.mockRejectedValue(new Error('db'))
    expect((await callback(cookieFor())).headers.get('location')).toContain('reason=unavailable')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, route modules not found.

- [ ] **Step 3: Implement**

`lib/integrations/google/consent-reasons.ts`:

```ts
/**
 * Why a Google consent round-trip was refused. The callback writes these into
 * the return URL and the settings panel translates them, so both import this
 * one list. Deliberately dependency-free: the panel is a client component.
 */
export const CONSENT_ERROR_REASONS = [
  'consent_invalid', 'session_mismatch', 'denied', 'no_refresh_token', 'scope_missing', 'unavailable',
] as const
export type ConsentErrorReason = (typeof CONSENT_ERROR_REASONS)[number]

export function isConsentErrorReason(value: unknown): value is ConsentErrorReason {
  return typeof value === 'string' && (CONSENT_ERROR_REASONS as readonly string[]).includes(value)
}
```

`app/api/integrations/google/start/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-origin'
import { authorizeSearchConsoleAccount } from '@/lib/integrations/search-console/guard'
import { assertVaultConfigured, VaultError } from '@/lib/integrations/google/vault'
import {
  CONSENT_TTL_MS, GOOGLE_CONSENT_COOKIE, RETURN_PATH, signConsentState,
} from '@/lib/integrations/google/consent-state'
import { buildConsentUrl, googleOAuthConfig, pkcePair, randomState } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const access = await authorizeSearchConsoleAccount()
  if (!access.ok) return access.response

  try {
    assertVaultConfigured()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[google/start] GOOGLE_TOKEN_ENCRYPTION_KEY is missing or not 32 bytes')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) {
    console.error('[google/start] GOOGLE_OAUTH_CLIENT_ID / _SECRET are not set')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const requested = req.nextUrl.searchParams.get('return') ?? ''
  const returnPath = RETURN_PATH.test(requested) ? requested : '/en/dashboard/settings'
  const { verifier, challenge } = pkcePair()
  const state = randomState()

  const res = NextResponse.redirect(buildConsentUrl(cfg, { state, challenge }), 302)
  res.cookies.set(GOOGLE_CONSENT_COOKIE, signConsentState({
    state, verifier, profileId: access.profile.id, accountId: access.profile.account_id, returnPath,
  }), {
    httpOnly: true,
    secure: true,
    // Lax, not Strict: the cookie must survive Google's top-level redirect back.
    sameSite: 'lax',
    path: '/api/integrations/google',
    maxAge: Math.floor(CONSENT_TTL_MS / 1000),
  })
  return res
}
```

`app/api/integrations/google/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-origin'
import { authorizeSearchConsoleAccount } from '@/lib/integrations/search-console/guard'
import { upsertConnection } from '@/lib/integrations/search-console/store'
import { sealToken } from '@/lib/integrations/google/vault'
import { GOOGLE_CONSENT_COOKIE, verifyConsentState } from '@/lib/integrations/google/consent-state'
import type { ConsentErrorReason as Reason } from '@/lib/integrations/google/consent-reasons'
import { SEARCH_CONSOLE_SCOPE, exchangeCode, googleOAuthConfig, type TokenGrant } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

/**
 * Finishes consent (spec §4.1). Every refusal returns the owner to a page that
 * names the reason; nothing is stored unless the connection can actually sync.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin().replace(/\/$/, '')
  const consent = verifyConsentState(req.cookies.get(GOOGLE_CONSENT_COOKIE)?.value)
  const back = (reason: Reason | null) => {
    const path = consent?.returnPath ?? '/en/dashboard/settings'
    const query = reason ? `google=error&reason=${reason}` : 'google=connected'
    const res = NextResponse.redirect(`${origin}${path}?${query}`, 302)
    res.cookies.set(GOOGLE_CONSENT_COOKIE, '', { path: '/api/integrations/google', maxAge: 0 })
    return res
  }

  const access = await authorizeSearchConsoleAccount()
  if (!access.ok) return access.response

  const params = req.nextUrl.searchParams
  if (!consent || params.get('state') !== consent.state) return back('consent_invalid')
  if (consent.profileId !== access.profile.id || consent.accountId !== access.profile.account_id) {
    return back('session_mismatch')
  }
  const code = params.get('code')
  if (!code) return back('denied')

  const cfg = googleOAuthConfig(process.env, origin)
  if (!cfg) return Response.json({ error: 'Server misconfiguration' }, { status: 500 })

  let grant: TokenGrant
  try {
    grant = await exchangeCode(cfg, { code, verifier: consent.verifier })
  } catch {
    return back('unavailable')
  }
  if (!grant.refreshToken) return back('no_refresh_token')
  if (!grant.scopes.includes(SEARCH_CONSOLE_SCOPE)) return back('scope_missing')

  try {
    await upsertConnection({
      accountId: access.profile.account_id,
      profileId: access.profile.id,
      subject: grant.subject,
      email: grant.email,
      scopes: grant.scopes,
      // Bound to this account: a ciphertext copied into another account's row cannot be opened.
      sealed: sealToken(grant.refreshToken, { accountId: access.profile.account_id }),
    })
  } catch {
    // Never report "connected" over a failed write.
    return back('unavailable')
  }
  return back(null)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/api/search-console-consent.test.ts __tests__/api/route-gate-inventory.test.ts` → PASS. The gate inventory accepts both routes because they import `guard.ts`, which calls `getProfile`.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/google/consent-reasons.ts app/api/integrations/google __tests__/api/search-console-consent.test.ts
git commit -m "feat(search-console): consent start and callback routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Account connections route

**Files:** Create `app/api/account/integrations/google/route.ts`. Test `__tests__/api/search-console-connections.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => ({ listConnections: vi.fn(), loadConnectionSecret: vi.fn(), revokeConnectionRow: vi.fn() }))
const revokeToken = vi.hoisted(() => vi.fn())
const openToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/integrations/search-console/store', () => store)
vi.mock('@/lib/integrations/google/oauth', async o => ({ ...(await o<object>()), revokeToken }))
vi.mock('@/lib/integrations/google/vault', async o => ({ ...(await o<object>()), openToken }))

const profile = { id: 'p', account_id: 'acct', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const sealed = { ciphertext: Buffer.from('x'), keyId: 'k' }

beforeEach(() => {
  process.env.FEATURE_SEARCH_CONSOLE = '1'
  getProfile.mockReset().mockResolvedValue(profile)
  Object.values(store).forEach(fn => fn.mockReset())
  revokeToken.mockReset()
  openToken.mockReset().mockReturnValue('1//r')
})

describe('GET', () => {
  it('lists only the session account\'s connections', async () => {
    store.listConnections.mockResolvedValue([{ id: 'g', googleEmail: 'o@e.com', status: 'active', scopes: [], createdAt: 'x' }])
    const { GET } = await import('@/app/api/account/integrations/google/route')
    const res = await GET()
    expect(store.listConnections).toHaveBeenCalledWith('acct')
    expect((await res.json()).connections).toHaveLength(1)
  })

  it('is 503 when the read fails', async () => {
    store.listConnections.mockRejectedValue(new Error('db'))
    const { GET } = await import('@/app/api/account/integrations/google/route')
    expect((await GET()).status).toBe(503)
  })
})

describe('DELETE', () => {
  const del = async (id: string | null) => {
    const { DELETE } = await import('@/app/api/account/integrations/google/route')
    return DELETE(new Request(`https://app.test/api/account/integrations/google${id ? `?id=${id}` : ''}`, { method: 'DELETE' }))
  }

  it('is 400 without an id', async () => {
    expect((await del(null)).status).toBe(400)
  })

  it('is 404 for a connection that is not the account\'s', async () => {
    store.loadConnectionSecret.mockResolvedValue(null)
    expect((await del('g')).status).toBe(404)
    expect(store.revokeConnectionRow).not.toHaveBeenCalled()
  })

  it('deletes locally even when Google refuses the revoke, and says so', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'active', sealed })
    revokeToken.mockResolvedValue(false)
    store.revokeConnectionRow.mockResolvedValue(true)
    const res = await del('g')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: true, googleRevoked: false })
    expect(store.revokeConnectionRow).toHaveBeenCalledWith('acct', 'g')
  })

  it('still deletes locally when the token cannot be decrypted', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'active', sealed })
    openToken.mockImplementation(() => { throw new Error('vault') })
    store.revokeConnectionRow.mockResolvedValue(true)
    expect(await (await del('g')).json()).toEqual({ revoked: true, googleRevoked: false })
  })

  it('is 503 when the local delete fails', async () => {
    store.loadConnectionSecret.mockResolvedValue({ status: 'revoked', sealed: null })
    store.revokeConnectionRow.mockRejectedValue(new Error('db'))
    expect((await del('g')).status).toBe(503)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { authorizeSearchConsoleAccount } from '@/lib/integrations/search-console/guard'
import { listConnections, loadConnectionSecret, revokeConnectionRow } from '@/lib/integrations/search-console/store'
import { openToken } from '@/lib/integrations/google/vault'
import { revokeToken } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

/** No account parameter: the account is the session's, like /api/account/*. */
export async function GET() {
  const access = await authorizeSearchConsoleAccount()
  if (!access.ok) return access.response
  try {
    return Response.json({ connections: await listConnections(access.profile.account_id) })
  } catch {
    return Response.json({ error: 'Lookup failed' }, { status: 503 })
  }
}

/**
 * Revoke at Google best-effort, then delete our copy regardless (spec §5). The
 * response says whether Google accepted, so the owner knows when to remove
 * access in their Google account too.
 */
export async function DELETE(req: Request) {
  const access = await authorizeSearchConsoleAccount()
  if (!access.ok) return access.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const accountId = access.profile.account_id
  let secret: Awaited<ReturnType<typeof loadConnectionSecret>>
  try {
    secret = await loadConnectionSecret(accountId, id)
  } catch {
    return Response.json({ error: 'Lookup failed' }, { status: 503 })
  }
  if (!secret) return Response.json({ error: 'Not found' }, { status: 404 })

  let googleRevoked = false
  if (secret.sealed) {
    try {
      googleRevoked = await revokeToken(openToken(secret.sealed, { accountId }))
    } catch {
      googleRevoked = false
    }
  }

  try {
    await revokeConnectionRow(accountId, id)
  } catch {
    return Response.json({ error: 'Revoke failed' }, { status: 503 })
  }
  return Response.json({ revoked: true, googleRevoked })
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/account/integrations/google/route.ts __tests__/api/search-console-connections.test.ts
git commit -m "feat(search-console): list and revoke account connections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Brand binding route

**Files:** Create `app/api/dashboard/clients/[clientId]/search-console/route.ts`. Test `__tests__/api/search-console-binding.test.ts`. `PUT` re-lists properties through the chosen connection instead of trusting a permission level from the request body.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeSearchConsole = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => ({
  listConnections: vi.fn(), loadConnectionSecret: vi.fn(), bindProperty: vi.fn(),
  unbindProperty: vi.fn(), loadBinding: vi.fn(), loadPanelData: vi.fn(),
}))
const listSites = vi.hoisted(() => vi.fn())
vi.mock('@/lib/integrations/search-console/guard', () => ({ authorizeSearchConsole }))
vi.mock('@/lib/integrations/search-console/store', () => store)
vi.mock('@/lib/integrations/search-console/client', () => ({ listSites }))
vi.mock('@/lib/integrations/google/vault', async o => ({ ...(await o<object>()), openToken: () => '1//r' }))
vi.mock('@/lib/integrations/google/oauth', async o => ({
  ...(await o<object>()),
  refreshAccessToken: vi.fn().mockResolvedValue('ya29.a'),
  googleOAuthConfig: () => ({ clientId: 'c', clientSecret: 's', redirectUri: 'r' }),
}))

const allowed = {
  ok: true, profile: { id: 'p', account_id: 'acct', accounts: { plan: 'pro' } }, client: { id: 'c1', domain: 'example.com' },
}
const ctx = { params: Promise.resolve({ clientId: 'c1' }) }
const put = (body: unknown) => new Request('https://app.test/', { method: 'PUT', body: JSON.stringify(body) })

beforeEach(() => {
  authorizeSearchConsole.mockReset().mockResolvedValue(allowed)
  Object.values(store).forEach(fn => fn.mockReset())
  listSites.mockReset()
  store.loadConnectionSecret.mockResolvedValue({ status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } })
})

describe('PUT bind', () => {
  it('binds an eligible property using the permission Google reports', async () => {
    listSites.mockResolvedValue([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }])
    store.bindProperty.mockResolvedValue(true)
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: 'g', siteUrl: 'sc-domain:example.com', permissionLevel: 'forged' }), ctx)
    expect(res.status).toBe(200)
    expect(store.bindProperty).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acct', clientId: 'c1', permissionLevel: 'siteOwner', boundDomain: 'example.com',
    }))
  })

  it('refuses a property for another domain, with its reason', async () => {
    listSites.mockResolvedValue([{ siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }])
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const res = await PUT(put({ connectionId: 'g', siteUrl: 'sc-domain:other.com' }), ctx)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INELIGIBLE', reason: 'other_domain' })
    expect(store.bindProperty).not.toHaveBeenCalled()
  })

  it('refuses a property the connection cannot see', async () => {
    listSites.mockResolvedValue([])
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await PUT(put({ connectionId: 'g', siteUrl: 'sc-domain:example.com' }), ctx)).status).toBe(422)
  })

  it('is 404 for another account\'s connection', async () => {
    store.loadConnectionSecret.mockResolvedValue(null)
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await PUT(put({ connectionId: 'g', siteUrl: 'sc-domain:example.com' }), ctx)).status).toBe(404)
  })

  it('returns the guard\'s response untouched', async () => {
    authorizeSearchConsole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await PUT(put({}), ctx)).status).toBe(403)
  })
})

describe('DELETE unbind', () => {
  it('is 404 when nothing was bound', async () => {
    store.unbindProperty.mockResolvedValue(false)
    const { DELETE } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    expect((await DELETE(new Request('https://app.test/', { method: 'DELETE' }), ctx)).status).toBe(404)
  })
})

describe('GET', () => {
  it('derives the owner state from the binding and the ledger', async () => {
    store.loadBinding.mockResolvedValue({
      connectionId: 'g', siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', boundDomain: 'example.com',
      backfillPending: false, connectionStatus: 'active', currentDomain: 'example.com',
    })
    store.loadPanelData.mockResolvedValue({
      latest: { outcome: 'ok', dataThrough: '2026-09-20' }, lastGoodDataThrough: '2026-09-20', property: null, pages: [],
    })
    store.listConnections.mockResolvedValue([])
    const { GET } = await import('@/app/api/dashboard/clients/[clientId]/search-console/route')
    const body = await (await GET(new Request('https://app.test/'), ctx)).json()
    expect(body.state).toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { appOrigin } from '@/lib/app-origin'
import { authorizeSearchConsole } from '@/lib/integrations/search-console/guard'
import {
  bindProperty, listConnections, loadBinding, loadConnectionSecret, loadPanelData, unbindProperty,
} from '@/lib/integrations/search-console/store'
import { listSites, type SiteEntry } from '@/lib/integrations/search-console/client'
import { normalizeBrandDomain, propertyEligibility } from '@/lib/integrations/search-console/binding'
import { deriveOwnerState } from '@/lib/integrations/search-console/state'
import { openToken } from '@/lib/integrations/google/vault'
import { GoogleApiError, googleOAuthConfig, refreshAccessToken } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ clientId: string }> }

/** Null when the connection is not this account's. Throws GoogleApiError otherwise. */
async function sitesFor(accountId: string, connectionId: string): Promise<SiteEntry[] | null> {
  const secret = await loadConnectionSecret(accountId, connectionId)
  if (!secret) return null
  if (secret.status !== 'active' || !secret.sealed) throw new GoogleApiError('revoked', 0)
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) throw new GoogleApiError('unavailable', 0)
  return listSites(await refreshAccessToken(cfg, openToken(secret.sealed, { accountId })))
}

export async function GET(_req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeSearchConsole(clientId)
  if (!access.ok) return access.response
  const accountId = access.profile.account_id

  try {
    const [binding, panel, connections] = await Promise.all([
      loadBinding(accountId, clientId),
      loadPanelData(accountId, clientId),
      listConnections(accountId),
    ])
    const properties = await Promise.all(connections.filter(c => c.status === 'active').map(async c => {
      try {
        const sites = (await sitesFor(accountId, c.id)) ?? []
        return {
          connectionId: c.id, googleEmail: c.googleEmail, error: null,
          sites: sites.map(s => ({ ...s, verdict: propertyEligibility(s.siteUrl, s.permissionLevel, access.client.domain) })),
        }
      } catch (error) {
        return {
          connectionId: c.id, googleEmail: c.googleEmail, sites: [],
          error: error instanceof GoogleApiError ? error.kind : 'unavailable',
        }
      }
    }))

    const state = deriveOwnerState({
      bound: binding !== null,
      // The guard has already refused an unentitled caller.
      entitled: true,
      connectionStatus: binding?.connectionStatus ?? null,
      domainMatches: binding
        ? normalizeBrandDomain(binding.currentDomain) === normalizeBrandDomain(binding.boundDomain)
        : true,
      latest: panel.latest,
      lastGoodDataThrough: panel.lastGoodDataThrough,
    })
    return Response.json({ state, binding, panel, properties })
  } catch {
    return Response.json({ error: 'Lookup failed' }, { status: 503 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeSearchConsole(clientId)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null) as { connectionId?: unknown; siteUrl?: unknown } | null
  if (!body || typeof body.connectionId !== 'string' || typeof body.siteUrl !== 'string') {
    return Response.json({ error: 'connectionId and siteUrl required' }, { status: 400 })
  }
  const accountId = access.profile.account_id

  let sites: SiteEntry[] | null
  try {
    sites = await sitesFor(accountId, body.connectionId)
  } catch (error) {
    const kind = error instanceof GoogleApiError ? error.kind : 'unavailable'
    return Response.json({ error: 'GOOGLE', reason: kind }, { status: kind === 'revoked' ? 409 : 503 })
  }
  if (!sites) return Response.json({ error: 'Not found' }, { status: 404 })

  // Never trust a permission level from the body: take Google's.
  const site = sites.find(s => s.siteUrl === body.siteUrl)
  if (!site) return Response.json({ error: 'INELIGIBLE', reason: 'not_visible' }, { status: 422 })
  const verdict = propertyEligibility(site.siteUrl, site.permissionLevel, access.client.domain)
  if (!verdict.eligible) return Response.json({ error: 'INELIGIBLE', reason: verdict.reason }, { status: 422 })

  try {
    const bound = await bindProperty({
      accountId, clientId, connectionId: body.connectionId, siteUrl: site.siteUrl,
      permissionLevel: site.permissionLevel,
      boundDomain: normalizeBrandDomain(access.client.domain)!,
      profileId: access.profile.id,
    })
    if (!bound) return Response.json({ error: 'Not found' }, { status: 404 })
  } catch {
    return Response.json({ error: 'Bind failed' }, { status: 503 })
  }
  return Response.json({ bound: true })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeSearchConsole(clientId)
  if (!access.ok) return access.response
  try {
    const removed = await unbindProperty(access.profile.account_id, clientId)
    return removed ? Response.json({ unbound: true }) : Response.json({ error: 'Not found' }, { status: 404 })
  } catch {
    return Response.json({ error: 'Unbind failed' }, { status: 503 })
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run __tests__/api/search-console-binding.test.ts __tests__/api/route-gate-inventory.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/dashboard/clients/[clientId]/search-console/route.ts" __tests__/api/search-console-binding.test.ts
git commit -m "feat(search-console): brand binding route with Google-sourced permission

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Cron route

**Files:** Create `app/api/cron/search-console/route.ts`. Modify `vercel.json`, `__tests__/config/function-durations.test.ts`. Test `__tests__/api/search-console-cron.test.ts`.

`lib/cron/recordRun.ts` exports `startCronRun(route: string): Promise<string | null>` and `finishCronRun(id, status: 'ok' | 'error', detail?, error?)`; `app/api/cron/trial-emails/route.ts` is the reference caller.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadDueBindings = vi.hoisted(() => vi.fn())
const syncBinding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/integrations/search-console/store', () => ({
  loadDueBindings, loadConnectionSecret: vi.fn(), listSyncPages: vi.fn(), writeDaily: vi.fn(),
  writePageQueries: vi.fn(), markConnection: vi.fn(), recordRun: vi.fn(),
}))
vi.mock('@/lib/integrations/search-console/sync', () => ({ syncBinding }))
vi.mock('@/lib/cron/recordRun', () => ({ startCronRun: vi.fn().mockResolvedValue('run'), finishCronRun: vi.fn() }))

const call = async (auth = 'Bearer cron-secret-0123456789') => {
  const { GET } = await import('@/app/api/cron/search-console/route')
  return GET(new Request('https://app.test/api/cron/search-console', { headers: { authorization: auth } }))
}

beforeEach(() => {
  Object.assign(process.env, {
    CRON_SECRET: 'cron-secret-0123456789', FEATURE_SEARCH_CONSOLE: '1',
    GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  })
  loadDueBindings.mockReset().mockResolvedValue([])
  syncBinding.mockReset()
})

describe('GET /api/cron/search-console', () => {
  it('rejects a wrong secret', async () => {
    expect((await call('Bearer nope')).status).toBe(401)
  })

  it('is 500 when CRON_SECRET is too short to be one', async () => {
    process.env.CRON_SECRET = 'short'
    expect((await call('Bearer short')).status).toBe(500)
  })

  it('skips cleanly with the flag off, never looking like an outage', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'flag_off' })
    expect(loadDueBindings).not.toHaveBeenCalled()
  })

  it('counts outcomes', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }, { clientId: 'b' }]).mockResolvedValue([])
    syncBinding.mockResolvedValueOnce('ok').mockResolvedValueOnce('quota')
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).outcomes).toEqual({ ok: 1, quota: 1 })
  })

  it('is 502 when bindings were due and none synced', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }]).mockResolvedValue([])
    syncBinding.mockResolvedValue('google_unavailable')
    expect((await call()).status).toBe(502)
  })

  it('is not 502 when every binding was a deliberate skip', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }]).mockResolvedValue([])
    syncBinding.mockResolvedValue('not_entitled')
    expect((await call()).status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { appOrigin } from '@/lib/app-origin'
import { isFeatureEnabled } from '@/lib/flags'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { assertVaultConfigured, openToken, VaultError } from '@/lib/integrations/google/vault'
import { googleOAuthConfig, refreshAccessToken } from '@/lib/integrations/google/oauth'
import { querySearchAnalytics } from '@/lib/integrations/search-console/client'
import * as store from '@/lib/integrations/search-console/store'
import { syncBinding } from '@/lib/integrations/search-console/sync'
import type { SyncOutcome } from '@/lib/integrations/search-console/state'

export const dynamic = 'force-dynamic'

/** Stop taking new bindings well inside vercel.json's 60s maxDuration. */
const BUDGET_MS = 45_000
const BATCH = 10
/** Deliberate skips are not failures of this run. */
const SKIPS: ReadonlySet<SyncOutcome> = new Set(['not_entitled', 'domain_mismatch'])

function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  return secret && secret.length >= 16 ? secret : null
}

export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/search-console] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isFeatureEnabled('search_console')) return Response.json({ skipped: 'flag_off' })

  try {
    assertVaultConfigured()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) return Response.json({ error: 'Server misconfiguration' }, { status: 500 })

  const runId = await startCronRun('/api/cron/search-console')
  const started = Date.now()
  const outcomes: Partial<Record<SyncOutcome, number>> = {}
  let due = 0
  try {
    while (Date.now() - started < BUDGET_MS) {
      const batch = await store.loadDueBindings(BATCH)
      if (!batch.length) break
      for (const binding of batch) {
        if (Date.now() - started >= BUDGET_MS) break
        const outcome = await syncBinding(binding, {
          loadSecret: store.loadConnectionSecret,
          open: (sealed, accountId) => openToken(sealed, { accountId }),
          refresh: token => refreshAccessToken(cfg, token),
          query: querySearchAnalytics,
          listPages: store.listSyncPages,
          writeDaily: store.writeDaily,
          writePageQueries: store.writePageQueries,
          markConnection: store.markConnection,
          recordRun: store.recordRun,
          today: () => new Date().toISOString().slice(0, 10),
        })
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
        if (!SKIPS.has(outcome)) due++
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishCronRun(runId, 'error', { outcomes }, message)
    console.error('[cron/search-console] run failed:', message)
    return Response.json({ error: 'Sync failed', outcomes }, { status: 500 })
  }

  // evaluate-alerts' rule: work was due and none of it succeeded.
  const failed = due > 0 && !outcomes.ok
  await finishCronRun(runId, failed ? 'error' : 'ok', { outcomes })
  return Response.json({ outcomes }, { status: failed ? 502 : 200 })
}
```

`vercel.json` — add inside `functions`:

```json
    "app/api/cron/search-console/route.ts": { "maxDuration": 60 }
```

`__tests__/config/function-durations.test.ts` — append to `LLM_ROUTES`:

```ts
  // Not an LLM caller: a paced loop of Google API calls under a 45s budget.
  'app/api/cron/search-console/route.ts',
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run __tests__/api/search-console-cron.test.ts __tests__/config/function-durations.test.ts __tests__/api/route-gate-inventory.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/search-console vercel.json __tests__/api/search-console-cron.test.ts __tests__/config/function-durations.test.ts
git commit -m "feat(search-console): daily cron route with outcome counts and 502 rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Cron worker — one schedule, several routes

**Files:** Modify `cloudflare/cron-worker/src/index.ts`, `cloudflare/cron-worker/test/scheduled.test.ts`, `__tests__/config/function-durations.test.ts`.

The worker has its own toolchain: read `cloudflare/cron-worker/package.json`, run `npm install` there if `node_modules` is absent, and run its tests from that directory.

- [ ] **Step 1: Write the failing tests**

In `cloudflare/cron-worker/test/scheduled.test.ts`, replace `'calls cron/trial-emails for the trial-emails schedule'` with:

```ts
  it('calls trial-emails and search-console on the daily schedule', async () => {
    await worker.scheduled(controller('0 9 * * *'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/trial-emails',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/search-console',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('still calls every route on a schedule when one of them fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/trial-emails') ? { ok: false, status: 500 } : { ok: true, status: 200 })

    await expect(worker.scheduled(controller('0 9 * * *'), env, ctx))
      .rejects.toThrow('[cron-worker] /api/cron/trial-emails responded 500')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
```

In `__tests__/config/function-durations.test.ts`, in `'schedules exactly the three cron routes, and every one exists'`, change `paths` to:

```ts
    const paths = [
      '/api/cron/pulse', '/api/cron/evaluate-alerts', '/api/cron/trial-emails', '/api/cron/search-console',
    ]
```

and add inside the same `describe`:

```ts
  it('runs the Search Console sync on the existing daily trigger, not a fourth one', () => {
    const worker = readFileSync(join(process.cwd(), 'cloudflare/cron-worker/src/index.ts'), 'utf8')
    expect(worker).toMatch(/'0 9 \* \* \*':\s*\[\s*'\/api\/cron\/trial-emails',\s*'\/api\/cron\/search-console'\s*\]/)
  })
```

- [ ] **Step 2: Run to verify they fail**

`cd cloudflare/cron-worker && npm test` → FAIL (only one fetch).
`npx vitest run __tests__/config/function-durations.test.ts` → FAIL on the new assertion.

- [ ] **Step 3: Implement** — replace the `ROUTES` block and `scheduled` in `cloudflare/cron-worker/src/index.ts`:

```ts
// Keep in sync with wrangler.jsonc's triggers.crons — test/scheduled.test.ts
// asserts the keys agree. A schedule may call several routes: the free tier
// allows three triggers per Worker and all three are used, so the daily trigger
// carries both trial emails and the Search Console sync.
export const ROUTES: Record<string, readonly string[]> = {
  '17 4 * * 1': ['/api/cron/pulse'],
  '47 7 * * 1': ['/api/cron/evaluate-alerts'],
  '0 9 * * *': ['/api/cron/trial-emails', '/api/cron/search-console'],
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const paths = ROUTES[controller.cron]
    if (!paths?.length) {
      console.error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
      throw new Error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
    }

    // Independent calls: one route failing must never skip another.
    const results = await Promise.allSettled(paths.map(async path => {
      const res = await fetch(`${env.APP_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      })
      if (!res.ok) throw new Error(`[cron-worker] ${path} responded ${res.status}`)
    }))

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failures.length) {
      // Propagate the failed attempt(s); this Worker does not implement retries.
      throw new Error(failures.map(f => (f.reason as Error).message).join('; '))
    }
  },
}
```

- [ ] **Step 4: Run to verify they pass**

`cd cloudflare/cron-worker && npm test` → PASS, including the unchanged "ROUTES stays in sync with wrangler.jsonc" test (it reads only the keys).
`npx vitest run __tests__/config/function-durations.test.ts` → PASS; the 3-trigger ceiling still holds.

- [ ] **Step 5: Commit**

```bash
git add cloudflare/cron-worker/src/index.ts cloudflare/cron-worker/test/scheduled.test.ts __tests__/config/function-durations.test.ts
git commit -m "feat(cron-worker): let one schedule call several independent routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Deployment note:** this takes effect only when the worker is deployed (`docs/runbooks/deploy-cron-worker.md`). Until then the sync route exists but nothing calls it — say so in the PR.

---

### Task 18: Real-Postgres suite in the exact-target wrapper

**Files:** Create `__tests__/integration/search-console.test.ts`, `vitest.search-console-integration.config.ts`. Modify `scripts/ci/run-exact-target-suites.mjs`, `vitest.integration.config.ts`, `__tests__/ci/exact-target-suites.test.ts`.

- [ ] **Step 1: Write the suite**

```ts
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { assertApprovedTarget } from './approved-target'
import { TENANCY_TARGET_VARIABLES, approvedTenancyTarget, assertDisposableTenancyTarget } from './tenancy-target'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * Migration 054 and the Search Console store against real Postgres (spec §7).
 * Run through scripts/ci/run-exact-target-suites.mjs, which provisions one
 * disposable branch and derives the C9F_TENANCY_* approval from it.
 */

const A = 'c1500000-0000-4000-8000-00000000000a'
const B = 'c1500000-0000-4000-8000-00000000000b'
const A_CLIENT = 'c1500000-0000-4000-8000-0000000000a1'
const B_CLIENT = 'c1500000-0000-4000-8000-0000000000b1'
const A_USER = 'c1500000-0000-4000-8000-0000000000a9'
const B_USER = 'c1500000-0000-4000-8000-0000000000b9'
const sealed = { ciphertext: Buffer.from([0, 1, 2, 250, 251, 252, 0x5c, 0x78]), keyId: '0123456789abcdef' }

async function teardown() {
  await sql`delete from search_console_sync_runs where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_page_queries where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_daily where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_bindings where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from google_connections where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from clients where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from profiles where id in (${A_USER}::uuid, ${B_USER}::uuid)`
  await sql`delete from neon_auth.user where id in (${A_USER}, ${B_USER})`
  await sql`delete from accounts where id in (${A}::uuid, ${B}::uuid)`
}

beforeAll(async () => {
  const target = approvedTenancyTarget()
  assertApprovedTarget(target, TENANCY_TARGET_VARIABLES)
  await assertDisposableTenancyTarget(sql, target!)
})

beforeEach(async () => {
  await teardown()
  for (const [account, client, user, domain] of [
    [A, A_CLIENT, A_USER, 'a-c15.example'], [B, B_CLIENT, B_USER, 'b-c15.example'],
  ]) {
    // Whole uuid: stripe_subscription_id is unique and suites share a branch.
    await sql`insert into accounts (id, plan, status, stripe_subscription_id)
              values (${account}::uuid, 'pro', 'active', ${'sub_' + account})`
    await sql`insert into neon_auth.user (id, email, name, "emailVerified")
              values (${user}, ${user + '@example.com'}, 'Owner', true)`
    await sql`insert into profiles (id, account_id, display_name) values (${user}::uuid, ${account}::uuid, 'Owner')`
    await sql`insert into clients (id, account_id, brand_name, status, competitors, domain)
              values (${client}::uuid, ${account}::uuid, 'Brand', 'active', ${[]}::text[], ${domain})`
  }
})

describe('migration 054 on real Postgres', () => {
  it('round-trips the ciphertext byte for byte through bytea', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const id = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    const loaded = await store.loadConnectionSecret(A, id)
    expect(loaded?.sealed?.ciphertext.equals(sealed.ciphertext)).toBe(true)
    expect(loaded?.sealed?.keyId).toBe(sealed.keyId)
  })

  it('overwrites a re-synced day instead of double-counting property rows', async () => {
    const { writeDaily } = await import('@/lib/integrations/search-console/store')
    const day = { date: '2026-09-20', scope: 'property' as const, pageUrl: null, clicks: 1, impressions: 10, ctr: 0.1, position: 4 }
    await writeDaily(A, A_CLIENT, [day])
    await writeDaily(A, A_CLIENT, [{ ...day, clicks: 7 }])
    expect(await sql`select clicks from search_console_daily where client_id = ${A_CLIENT}::uuid`).toEqual([{ clicks: 7 }])
  })

  it('refuses a property row that names a page', async () => {
    await expect(sql`
      insert into search_console_daily (account_id, client_id, date, scope, page_url, clicks, impressions, ctr, position)
      values (${A}::uuid, ${A_CLIENT}::uuid, '2026-09-20', 'property', 'https://x', 0, 0, 0, 0)
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('refuses an outcome outside the vocabulary', async () => {
    await expect(sql`
      insert into search_console_sync_runs (account_id, client_id, outcome) values (${A}::uuid, ${A_CLIENT}::uuid, 'nearly_ok')
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('gives aeo_app no DELETE on history, and DELETE on bindings', async () => {
    const [grants] = await sql`select
      has_table_privilege('aeo_app', 'public.search_console_daily', 'DELETE') as daily,
      has_table_privilege('aeo_app', 'public.search_console_sync_runs', 'DELETE') as runs,
      has_table_privilege('aeo_app', 'public.search_console_bindings', 'DELETE') as bindings`
    expect(grants).toEqual({ daily: false, runs: false, bindings: true })
  })

  it('keeps the account when the connecting profile is deleted (column-list set null)', async () => {
    const { upsertConnection } = await import('@/lib/integrations/search-console/store')
    const id = await upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    await sql`delete from profiles where id = ${A_USER}::uuid`
    const [row] = await sql`select account_id, connected_by from google_connections where id = ${id}::uuid`
    expect(row).toEqual({ account_id: A, connected_by: null })
  })
})

describe('cross-account, as B against A', () => {
  it('lists none of A\'s connections', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: 'a@e.com', scopes: [], sealed })
    expect(await store.listConnections(B)).toEqual([])
    expect(await store.listConnections(A)).toHaveLength(1)
  })

  it('cannot bind its own brand through A\'s connection', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const aConn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    expect(await store.bindProperty({
      accountId: B, clientId: B_CLIENT, connectionId: aConn, siteUrl: 'sc-domain:b-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'b-c15.example', profileId: B_USER,
    })).toBe(false)
    expect(await sql`select 1 from search_console_bindings where client_id = ${B_CLIENT}::uuid`).toHaveLength(0)
  })

  it('cannot bind A\'s brand through its own connection', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const bConn = await store.upsertConnection({ accountId: B, profileId: B_USER, subject: 'g-b', email: null, scopes: [], sealed })
    expect(await store.bindProperty({
      accountId: B, clientId: A_CLIENT, connectionId: bConn, siteUrl: 'sc-domain:a-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: B_USER,
    })).toBe(false)
  })

  it('refuses the pairing at the database even if app code tried', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const aConn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    await expect(sql`
      insert into search_console_bindings (account_id, client_id, connection_id, site_url, permission_level, bound_domain)
      values (${B}::uuid, ${B_CLIENT}::uuid, ${aConn}::uuid, 'x', 'siteOwner', 'b-c15.example')
    `).rejects.toMatchObject({ code: '23503' })
  })

  it('cannot revoke A\'s connection', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const aConn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    expect(await store.revokeConnectionRow(B, aConn)).toBe(false)
    const [row] = await sql`select status from google_connections where id = ${aConn}::uuid`
    expect(row!.status).toBe('active')
  })

  it('writes each brand\'s metrics only to its own account during a sync', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const { syncBinding } = await import('@/lib/integrations/search-console/sync')
    for (const [account, client, user, domain, clicks] of [
      [A, A_CLIENT, A_USER, 'a-c15.example', 11], [B, B_CLIENT, B_USER, 'b-c15.example', 22],
    ] as const) {
      const conn = await store.upsertConnection({
        accountId: account, profileId: user, subject: `g-${client}`, email: null, scopes: [], sealed,
      })
      await store.bindProperty({
        accountId: account, clientId: client, connectionId: conn, siteUrl: `sc-domain:${domain}`,
        permissionLevel: 'siteOwner', boundDomain: domain, profileId: user,
      })
      const due = (await store.loadDueBindings(50)).find(b => b.clientId === client)
      expect(due).toBeDefined()
      await syncBinding(due!, {
        loadSecret: store.loadConnectionSecret,
        open: () => '1//r',
        refresh: async () => 'ya29.a',
        query: async () => [{ keys: ['2026-09-20'], clicks, impressions: 100, ctr: clicks / 100, position: 3 }],
        listPages: store.listSyncPages,
        writeDaily: store.writeDaily,
        writePageQueries: store.writePageQueries,
        markConnection: store.markConnection,
        recordRun: store.recordRun,
        today: () => '2026-09-24',
      })
    }
    const rows = await sql`
      select account_id, client_id, clicks from search_console_daily
      where account_id in (${A}::uuid, ${B}::uuid) order by clicks`
    expect(rows).toEqual([
      { account_id: A, client_id: A_CLIENT, clicks: 11 },
      { account_id: B, client_id: B_CLIENT, clicks: 22 },
    ])
    expect((await store.loadPanelData(B, A_CLIENT)).property).toBeNull()
    expect((await store.loadPanelData(A, A_CLIENT)).property?.clicks).toBe(11)
  })
})
```

`vitest.search-console-integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Explicit opt-in only: run through scripts/ci/run-exact-target-suites.mjs,
// which provisions the disposable branch this suite verifies in-band before
// writing anything. No global setup, branch creation or migration runner here.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/integration/search-console.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      'next/headers': resolve(__dirname, '__tests__/stubs/next-headers.ts'),
    },
  },
})
```

Wire it — three edits that must agree, or `__tests__/ci/exact-target-suites.test.ts` fails:
- `scripts/ci/run-exact-target-suites.mjs`: append `'vitest.search-console-integration.config.ts',` to `EXACT_TARGET_CONFIGS`.
- `vitest.integration.config.ts`: append `'__tests__/integration/search-console.test.ts'` to `exclude`.
- `__tests__/ci/exact-target-suites.test.ts`: append `'__tests__/integration/search-console.test.ts',` to `SUITES`.

- [ ] **Step 2: Run the wiring test** — `npx vitest run __tests__/ci/exact-target-suites.test.ts` → PASS.

- [ ] **Step 3: Run the suite for real**

Run: `node scripts/ci/run-exact-target-suites.mjs 2>&1 | grep -v "postgresql://"`
Expected: `10/10 suites`, including `ok   search-console-integration: 12 tests`, and the branch deleted at the end.

- [ ] **Step 4: Mutation check**

State the GateGuard facts, then temporarily delete `and g.account_id = c.account_id` from the join in `bindProperty` (`lib/integrations/search-console/store.ts`) and rerun the wrapper. Expected: `cannot bind its own brand through A's connection` fails — the insert now reaches the database, which refuses it with `23503`, so `bindProperty` throws instead of returning `false`. That proves both layers: the SQL predicate and, behind it, the composite FK. Restore with `git checkout -- lib/integrations/search-console/store.ts` and confirm `git diff --quiet -- lib/integrations/search-console/store.ts`.

- [ ] **Step 5: Commit**

```bash
git add __tests__/integration/search-console.test.ts vitest.search-console-integration.config.ts scripts/ci/run-exact-target-suites.mjs vitest.integration.config.ts __tests__/ci/exact-target-suites.test.ts
git commit -m "test(search-console): prove 054 and cross-account boundaries on real Postgres

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Owner UI, in both languages

**Files:** Create `components/integrations/GoogleConnectionsPanel.tsx`, `components/integrations/SearchConsolePanel.tsx`. Modify `messages/en.json`, `messages/zh-HK.json`, `__tests__/lib/message-catalogue-parity.test.ts`, `app/[lang]/dashboard/settings/page.tsx`, `app/[lang]/dashboard/[clientId]/assets/page.tsx`. Test `__tests__/components/search-console-bilingual.test.tsx`.

Follow `components/dashboard/AssetConvergenceView.tsx`: a `lang` prop, copy chosen from the imported catalogues, placeholders filled with `.replace`. Controls are at least 44px (`min-h-11`).

- [ ] **Step 1: Add the catalogue entries**

`messages/en.json` — new top-level key `searchConsole` (place it after `scanPage`):

```json
  "searchConsole": {
    "connections_title": "Google Search Console",
    "connections_body": "Connect a Google login that has access to your Search Console properties. AISO only reads search data; it never changes anything in your Google account.",
    "connect": "Connect Google",
    "disconnect": "Disconnect",
    "connected_as": "Connected as {email}",
    "status_needs_reconnect": "Needs reconnecting",
    "google_revoke_failed": "Disconnected here, but Google did not confirm the revocation. Remove AISO's access in your Google account settings as well.",
    "upgrade_title": "Search Console needs Pro",
    "upgrade_body": "Connect Search Console on the Pro or Enterprise plan to see measured clicks and impressions for your pages.",
    "panel_title": "Search performance",
    "panel_caption": "Measured by Google Search Console. These are search outcomes, separate from the technical score.",
    "data_through": "Data up to {date}. Google reports with a 2–3 day delay.",
    "choose_property": "Choose a Search Console property",
    "bind": "Use this property",
    "clicks": "Clicks (28 days)",
    "impressions": "Impressions (28 days)",
    "ctr": "Click-through rate",
    "position": "Average position",
    "whole_site": "Whole site",
    "state_unbound": "No property chosen for this brand yet.",
    "state_awaiting_first_sync": "Property connected. First data arrives within a day.",
    "state_reconnect": "Reconnect Google to keep this data up to date.",
    "state_access_lost": "This Google login no longer has access to the property.",
    "state_retrying": "Google didn't respond. AISO will try again tomorrow.",
    "state_rebind": "This brand's domain changed. Choose a property for the new domain.",
    "state_paused_plan": "Syncing is paused because this account is no longer on Pro.",
    "state_temporarily_unavailable": "Search data is temporarily unavailable. No action is needed from you.",
    "reason_other_domain": "Doesn't cover this brand's domain",
    "reason_unverified": "Access not verified in Search Console",
    "reason_no_domain": "Add a domain to this brand first",
    "error_consent_invalid": "The connection request expired. Please try again.",
    "error_session_mismatch": "That connection was started by a different sign-in. Please start again.",
    "error_denied": "Google access wasn't granted.",
    "error_no_refresh_token": "Google didn't grant ongoing access. Please connect again and approve access.",
    "error_scope_missing": "Search Console access wasn't granted. Please connect again and tick Search Console.",
    "error_unavailable": "Couldn't finish connecting. Please try again."
  },
```

`messages/zh-HK.json` — same key, same position:

```json
  "searchConsole": {
    "connections_title": "Google Search Console",
    "connections_body": "連結一個可存取你 Search Console 資源的 Google 帳戶。AISO 只會讀取搜尋數據，不會更改你 Google 帳戶的任何內容。",
    "connect": "連結 Google",
    "disconnect": "中斷連結",
    "connected_as": "已連結為 {email}",
    "status_needs_reconnect": "需要重新連結",
    "google_revoke_failed": "已在此中斷連結，但 Google 未確認撤銷。請同時在你的 Google 帳戶設定中移除 AISO 的存取權。",
    "upgrade_title": "Search Console 需要專業版",
    "upgrade_body": "升級至專業版或企業版即可連結 Search Console，查看網頁實際量度的點擊及曝光。",
    "panel_title": "搜尋表現",
    "panel_caption": "由 Google Search Console 量度。這是搜尋成果，與技術分數分開。",
    "data_through": "數據截至 {date}。Google 的數據有 2 至 3 日延遲。",
    "choose_property": "選擇 Search Console 資源",
    "bind": "使用此資源",
    "clicks": "點擊（28 日）",
    "impressions": "曝光（28 日）",
    "ctr": "點擊率",
    "position": "平均排名",
    "whole_site": "整個網站",
    "state_unbound": "此品牌尚未選擇資源。",
    "state_awaiting_first_sync": "已連結資源。首批數據將於一日內送達。",
    "state_reconnect": "請重新連結 Google，以保持數據更新。",
    "state_access_lost": "此 Google 帳戶已無權存取該資源。",
    "state_retrying": "Google 沒有回應。AISO 會於明天再試。",
    "state_rebind": "此品牌的網域已更改。請為新網域選擇資源。",
    "state_paused_plan": "由於此帳戶已不再使用專業版，同步已暫停。",
    "state_temporarily_unavailable": "搜尋數據暫時無法使用。你無需採取任何行動。",
    "reason_other_domain": "不涵蓋此品牌的網域",
    "reason_unverified": "未在 Search Console 驗證存取權",
    "reason_no_domain": "請先為此品牌加入網域",
    "error_consent_invalid": "連結請求已過期，請再試一次。",
    "error_session_mismatch": "此連結由另一個登入開始，請重新開始。",
    "error_denied": "未獲授予 Google 存取權。",
    "error_no_refresh_token": "Google 未授予持續存取權。請重新連結並批准存取。",
    "error_scope_missing": "未授予 Search Console 存取權。請重新連結並勾選 Search Console。",
    "error_unavailable": "未能完成連結，請再試一次。"
  },
```

In `__tests__/lib/message-catalogue-parity.test.ts`, add `'searchConsole'` to the anchored namespace array, alphabetically after `'scanPage'`.

- [ ] **Step 2: Write the failing render test**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { SearchConsoleStateNotice } from '@/components/integrations/SearchConsolePanel'
import type { OwnerState } from '@/lib/integrations/search-console/state'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

const STATES: OwnerState[] = [
  { kind: 'unbound' },
  { kind: 'awaiting_first_sync' },
  { kind: 'synced', dataThrough: '2026-09-20' },
  { kind: 'reconnect', dataThrough: '2026-09-18' },
  { kind: 'access_lost', dataThrough: null },
  { kind: 'retrying', dataThrough: '2026-09-18' },
  { kind: 'rebind', dataThrough: null },
  { kind: 'paused_plan', dataThrough: '2026-09-18' },
  { kind: 'temporarily_unavailable', dataThrough: null },
]

const render = (state: OwnerState, lang: 'en' | 'zh-HK') =>
  renderToStaticMarkup(<SearchConsoleStateNotice state={state} lang={lang} />)

describe.each([['en', en], ['zh-HK', zhHK]] as const)('%s', (lang, messages) => {
  it.each(STATES)('renders $kind as a sentence, never blank', state => {
    const markup = render(state, lang)
    expect(markup.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0)
    if (state.kind !== 'synced') {
      expect(markup).toContain(messages.searchConsole[`state_${state.kind}` as keyof typeof messages.searchConsole])
    }
    if ('dataThrough' in state && state.dataThrough) expect(markup).toContain(state.dataThrough)
  })
})

it('says something different in each language for the same state', () => {
  const state: OwnerState = { kind: 'reconnect', dataThrough: null }
  expect(render(state, 'en')).not.toBe(render(state, 'zh-HK'))
})

describe.each(['en', 'zh-HK'] as const)('connections panel at touch size (%s)', lang => {
  it('gives every control a 44px minimum height', () => {
    const markup = renderToStaticMarkup(
      <GoogleConnectionsPanel
        lang={lang}
        entitled
        notice="scope_missing"
        connections={[{ id: 'g', googleEmail: 'o@example.com', status: 'needs_reconnect', scopes: [], createdAt: 'x' }]}
      />,
    )
    const controls = markup.match(/<(button|a)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThanOrEqual(2)
    for (const control of controls) expect(control).toContain('min-h-11')
  })
})
```

Add this import to the top of the test file:

```tsx
import { GoogleConnectionsPanel } from '@/components/integrations/GoogleConnectionsPanel'
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run __tests__/components/search-console-bilingual.test.tsx __tests__/lib/message-catalogue-parity.test.ts`
Expected: the render test FAILS (module not found); parity PASSES once both catalogues and the list are updated.

- [ ] **Step 4: Implement the components and mount them**

`components/integrations/SearchConsolePanel.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import type { OwnerState } from '@/lib/integrations/search-console/state'
import type { MetricTotals, PanelData } from '@/lib/integrations/search-console/store'

type Copy = typeof en.searchConsole
type Verdict = { eligible: boolean; reason?: 'no_domain' | 'other_domain' | 'unverified' }
type Site = { siteUrl: string; permissionLevel: string; verdict: Verdict }
type ConnectionProperties = { connectionId: string; googleEmail: string | null; sites: Site[]; error: string | null }
type Payload = { state: OwnerState; panel: PanelData; properties: ConnectionProperties[] }

const copyFor = (lang: string): Copy => (lang === 'zh-HK' ? zhHK : en).searchConsole
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export function SearchConsoleStateNotice({ state, lang }: { state: OwnerState; lang: string }) {
  const copy = copyFor(lang)
  const through = 'dataThrough' in state && state.dataThrough
    ? <p className="mt-1 text-xs text-muted-foreground">{copy.data_through.replace('{date}', state.dataThrough)}</p>
    : null
  if (state.kind === 'synced') return through
  return (
    <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
      <p>{copy[`state_${state.kind}`]}</p>
      {through}
    </div>
  )
}

export function SearchConsolePanel({ clientId, lang }: { clientId: string; lang: string }) {
  const copy = copyFor(lang)
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)

  async function load() {
    const res = await fetch(`/api/dashboard/clients/${clientId}/search-console`)
    if (!res.ok) {
      setFailed(true)
      return
    }
    setData(await res.json() as Payload)
  }

  useEffect(() => { void load() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function bind(connectionId: string, siteUrl: string) {
    await fetch(`/api/dashboard/clients/${clientId}/search-console`, {
      method: 'PUT',
      body: JSON.stringify({ connectionId, siteUrl }),
    })
    await load()
  }

  if (failed) return <p className="text-sm text-muted-foreground">{copy.state_temporarily_unavailable}</p>
  if (!data) return null

  const rows: Array<{ label: string } & MetricTotals> = [
    ...(data.panel.property ? [{ label: copy.whole_site, ...data.panel.property }] : []),
    ...data.panel.pages.map(p => ({ ...p, label: p.pageUrl })),
  ]
  const choosing = data.state.kind === 'unbound' || data.state.kind === 'rebind'

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground">{copy.panel_title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.panel_caption}</p>
      <div className="mt-4"><SearchConsoleStateNotice state={data.state} lang={lang} /></div>

      {choosing && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">{copy.choose_property}</p>
          {data.properties.flatMap(c => c.sites.map(site => (
            <div key={`${c.connectionId}:${site.siteUrl}`} className="flex items-center justify-between gap-3">
              <span className="break-all text-sm text-foreground">{site.siteUrl}</span>
              {site.verdict.eligible ? (
                <button
                  type="button"
                  onClick={() => void bind(c.connectionId, site.siteUrl)}
                  className="min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  {copy.bind}
                </button>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {site.verdict.reason ? copy[`reason_${site.verdict.reason}`] : null}
                </span>
              )}
            </div>
          )))}
        </div>
      )}

      {rows.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2" />
              <th>{copy.clicks}</th>
              <th>{copy.impressions}</th>
              <th>{copy.ctr}</th>
              <th>{copy.position}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-t border-border">
                <td className="break-all py-2 pr-3">{r.label}</td>
                <td>{r.clicks}</td>
                <td>{r.impressions}</td>
                <td>{pct(r.ctr)}</td>
                <td>{r.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

`components/integrations/GoogleConnectionsPanel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import type { ConnectionSummary } from '@/lib/integrations/search-console/store'
import type { ConsentErrorReason } from '@/lib/integrations/google/consent-reasons'

export function GoogleConnectionsPanel({
  lang, connections: initial, entitled, notice,
}: {
  lang: string
  connections: ConnectionSummary[]
  entitled: boolean
  notice: ConsentErrorReason | null
}) {
  const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
  const [connections, setConnections] = useState(initial)
  const [revokeWarning, setRevokeWarning] = useState(false)

  async function disconnect(id: string) {
    const res = await fetch(`/api/account/integrations/google?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) return
    const body = await res.json() as { googleRevoked: boolean }
    setRevokeWarning(!body.googleRevoked)
    setConnections(list => list.filter(c => c.id !== id))
  }

  return (
    <section id="google" className="scroll-mt-6 rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground">{copy.connections_title}</h2>
      {!entitled ? (
        <>
          <p className="mt-2 font-semibold text-foreground">{copy.upgrade_title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.upgrade_body}</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{copy.connections_body}</p>
          {notice && <p role="status" className="mt-3 text-sm text-foreground">{copy[`error_${notice}`]}</p>}
          {revokeWarning && <p role="status" className="mt-3 text-sm text-foreground">{copy.google_revoke_failed}</p>}
          <ul className="mt-4 space-y-2">
            {connections.filter(c => c.status !== 'revoked').map(c => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  {copy.connected_as.replace('{email}', c.googleEmail ?? '—')}
                  {c.status === 'needs_reconnect' && <> · {copy.status_needs_reconnect}</>}
                </span>
                <button
                  type="button"
                  onClick={() => void disconnect(c.id)}
                  className="min-h-11 rounded-lg border border-border px-4 text-sm"
                >
                  {copy.disconnect}
                </button>
              </li>
            ))}
          </ul>
          <a
            href={`/api/integrations/google/start?return=/${lang}/dashboard/settings`}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            {copy.connect}
          </a>
        </>
      )}
    </section>
  )
}
```

`app/[lang]/dashboard/settings/page.tsx` — add imports:

```tsx
import { isFeatureEnabled } from '@/lib/flags'
import { listConnections } from '@/lib/integrations/search-console/store'
import { GoogleConnectionsPanel } from '@/components/integrations/GoogleConnectionsPanel'
import { isConsentErrorReason } from '@/lib/integrations/google/consent-reasons'
```

change the signature and read the query:

```tsx
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { lang } = await params
  const search = await searchParams
```

compute, after `const membership = …`:

```tsx
  const searchConsoleOn = isFeatureEnabled('search_console')
  const searchConsoleEntitled = entitlement.features.search_console
  const connections = searchConsoleOn && searchConsoleEntitled ? await listConnections(profile.account_id) : []
  // Only a reason the callback itself generates is shown; anything else is ignored.
  const reason = search.google === 'error' ? search.reason : undefined
  const notice = isConsentErrorReason(reason) ? reason : null
```

and render, directly after `<MembersPanel … />`:

```tsx
        {searchConsoleOn && (
          <GoogleConnectionsPanel lang={lang} entitled={searchConsoleEntitled} connections={connections} notice={notice} />
        )}
```

`app/[lang]/dashboard/[clientId]/assets/page.tsx` — add imports:

```tsx
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { SearchConsolePanel } from '@/components/integrations/SearchConsolePanel'
```

and replace the returned `<AssetConvergenceView … />` with a fragment containing it unchanged, followed by the panel:

```tsx
  const searchConsole = isFeatureEnabled('search_console')
    && resolveCommercialEntitlement(profile.accounts).features.search_console

  return (
    <>
      <AssetConvergenceView
        convergence={buildAssetConvergence({ assets, declarations, findings: siteFindingsFromEvidence(evidence) })}
        suggestions={buildMergeSuggestions({ assets: toRegisteredPages(assets, declarations), sources })}
        lang={lang}
        clientId={clientId}
      />
      {searchConsole && <SearchConsolePanel clientId={clientId} lang={lang} />}
    </>
  )
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run __tests__/components/search-console-bilingual.test.tsx __tests__/lib/message-catalogue-parity.test.ts __tests__/components/orphaned-components.test.ts __tests__/components/asset-convergence-view.test.tsx`
Expected: PASS. Both new components are reachable from `app/`, so the orphan inventory does not grow.
Run: `npm run typecheck` and `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add components/integrations messages __tests__/lib/message-catalogue-parity.test.ts __tests__/components/search-console-bilingual.test.tsx "app/[lang]/dashboard/settings/page.tsx" "app/[lang]/dashboard/[clientId]/assets/page.tsx"
git commit -m "feat(search-console): settings and brand panels in English and Traditional Chinese

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Configuration, documentation, full verification

**Files:** Modify `.env.example`, `CLAUDE.md`.

- [ ] **Step 1: Document the variables** — add to `.env.example` in its existing style:

```bash
# --- Google Search Console connector (Phase 2) ---
# OAuth client from the Google Cloud project. Register one redirect URI per
# environment: <origin>/api/integrations/google/callback. Unset: connecting
# returns 500 and the daily sync refuses to run.
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
# 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored refresh
# tokens; separate from every other secret. Unset or wrong length: connect and
# sync return 500 — there is no plaintext fallback. Losing it means every
# connection must be reconnected.
GOOGLE_TOKEN_ENCRYPTION_KEY=
# Only during a key rotation: the previous key, so existing rows still open.
GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS=
# Dark launch. Exactly '1' turns the connector on; anything else hides every
# route (404) and panel.
FEATURE_SEARCH_CONSOLE=
```

- [ ] **Step 2: Document the rules** — add under "Database (Neon Postgres)" in `CLAUDE.md`:

```markdown
- **Search Console connector (migration `054`, Phase 2).** Google refresh tokens are
  sealed with AES-256-GCM in `lib/integrations/google/vault.ts` using
  `GOOGLE_TOKEN_ENCRYPTION_KEY`; the key never reaches SQL and there is no plaintext
  fallback. `search_console_daily` uses `unique nulls not distinct`, so a re-synced day
  overwrites — unlike `pulse_metrics`. Owner-visible state is derived from
  `search_console_sync_runs` (closed outcome vocabulary, mirrored by `SYNC_OUTCOMES`),
  never stored twice. `webmasters.readonly` is a Google *sensitive* scope: until Google
  verifies the OAuth app, consent shows an "unverified app" warning and the app is
  capped at 100 users. The daily sync rides the existing `0 9 * * *` Cloudflare trigger
  alongside trial emails; that worker change must be deployed on its own.
```

- [ ] **Step 3: Full verification** — every command must pass before pushing:

```bash
npm run typecheck
npm run lint
npm run test:unit
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
node scripts/ci/run-exact-target-suites.mjs 2>&1 | grep -v "postgresql://"
```

and, from `cloudflare/cron-worker`, its own `npm test`.
Expected: typecheck and lint clean; unit all green; integration project green; wrapper `10/10 suites`; worker green.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add .env.example CLAUDE.md
git commit -m "docs(search-console): environment variables and connector rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
```

The PR body must state: dark by default; `054` not applied to any persistent database; the cron-worker deploy is a separate step; Google's sensitive-scope verification is outstanding. End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: After merge — operator steps, each its own decision**

1. Apply `054` to the AISO development database: `npm run migrate -- --dry-run`, then `npm run migrate`, then `npm run migrate -- --verify`.
2. Create the Google Cloud OAuth client and set the four variables in development.
3. Pilot with `FEATURE_SEARCH_CONSOLE=1` in development on Fimmick's own properties.
4. Deploy the cron worker (`docs/runbooks/deploy-cron-worker.md`).
5. Start Google's sensitive-scope verification.
6. Production cutover — separate, as `050`–`053` were.

---

## Spec coverage

| Spec section | Task(s) |
|---|---|
| §2 decisions: approach, ownership, vault, data scope, binding rule, entitlement | 1, 2, 4, 6, 7, 10 |
| §3.1 modules | 2, 4, 5, 6, 7, 8, 10, 11, 12 |
| §3.2 migration `054` | 9, 18 |
| §3.3 routes, `vercel.json` | 13, 14, 15, 16 |
| §4.1 connect | 5, 6, 13 |
| §4.2 bind + binding rule + mismatch | 4, 12, 15 |
| §4.3 sync, windows, caps, query top-25, totals never summed; scheduling constraint | 12, 16, 17 |
| §4.4 show, data-up-to date, separate from technical score | 19 |
| §5 ledger outcomes, owner states, hard rules, disconnect | 8, 12, 14, 16, 3 |
| §6 gates, composite FKs, tenancy inventory, sensitive scope | 10, 11, 18, 20 |
| §7 testing: no real Google, unit, route, real Postgres, idempotency, cross-account, mutation, bilingual, scheduling | 2–19 |
| §8 rollout: flag, env vars, pilot, verification, cutover | 1, 20 |
