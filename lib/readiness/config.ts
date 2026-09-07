export const capabilityNames = ['claims', 'ai', 'billing', 'email', 'scheduler'] as const

export type Capability = (typeof capabilityNames)[number]
export type CapabilityPolicy = 'required' | 'verified-disabled' | 'unknown'

export type ReleasePolicy = {
  expected: {
    project: string
    branch: string
    role: string
    database: string
  }
  capabilities: Record<Capability, CapabilityPolicy>
}

export type ConfigCheck = {
  id: string
  status: 'pass' | 'fail' | 'unknown'
  code: string
}

type Env = Readonly<Record<string, string | undefined>>
type Rule = (value: string) => boolean

const nonempty: Rule = (value) => value.length > 0
const secret: Rule = (value) => value.length >= 32
const https: Rule = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search
  } catch {
    return false
  }
}
const database: Rule = (value) => {
  try {
    const url = new URL(value)
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && Boolean(url.hostname)
      && Boolean(url.username)
      && Boolean(url.password)
      && url.pathname.length > 1
  } catch {
    return false
  }
}

const core: Record<string, Rule> = {
  DATABASE_URL: database,
  NEON_AUTH_BASE_URL: https,
  NEON_AUTH_COOKIE_SECRET: secret,
  PUBLIC_SCAN_RATE_LIMIT_SECRET: secret,
  NEXT_PUBLIC_APP_URL: https,
  VERCEL: (value) => value === '1',
}

const requirements: Record<Capability, Record<string, Rule>> = {
  claims: { REPORT_SHARE_SECRET: secret },
  ai: { OPENROUTER_API_KEY: nonempty },
  billing: {
    STRIPE_SECRET_KEY: nonempty,
    STRIPE_WEBHOOK_SECRET: nonempty,
    STRIPE_PRICE_BASIC: (value) => value.startsWith('price_'),
    STRIPE_PRICE_PRO: (value) => value.startsWith('price_'),
    STRIPE_PRICE_ENTERPRISE: (value) => value.startsWith('price_'),
  },
  email: {
    RESEND_API_KEY: nonempty,
    RESEND_FROM_EMAIL: nonempty,
    RESEND_TRIAL_FROM_EMAIL: nonempty,
  },
  scheduler: { CRON_SECRET: secret },
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

export function validateConfiguration(env: Env, policy: ReleasePolicy): ConfigCheck[] {
  const checks: ConfigCheck[] = []
  const value = (key: string) => (env[key] ?? '').trim()
  const add = (id: string, valid: boolean, code: string) => {
    checks.push({ id, status: valid ? 'pass' : 'fail', code: valid ? 'valid' : code })
  }
  const checkRules = (rules: Record<string, Rule>) => {
    for (const [key, rule] of Object.entries(rules)) {
      const candidate = value(key)
      add(`config.${key}`, rule(candidate), candidate ? 'invalid' : 'missing')
    }
  }

  checkRules(core)

  const expected = {
    EXPECTED_NEON_PROJECT_ID: policy.expected.project,
    EXPECTED_NEON_BRANCH_ID: policy.expected.branch,
    EXPECTED_DB_ROLE: policy.expected.role,
    EXPECTED_DB_NAME: policy.expected.database,
  }
  for (const [key, target] of Object.entries(expected)) {
    add(`binding.${key}`, Boolean(target.trim()) && value(key) === target, 'expectation_mismatch')
  }

  let parsed: URL | undefined
  try {
    parsed = new URL(value('DATABASE_URL'))
  } catch {
    // The database rule already records malformed URLs without exposing them.
  }

  add(
    'binding.connection_role',
    Boolean(parsed)
      && safeDecode(parsed?.username ?? '') === policy.expected.role
      && policy.expected.role === 'aeo_app',
    'application_role_required',
  )
  add(
    'binding.connection_database',
    Boolean(parsed)
      && safeDecode(parsed?.pathname.slice(1) ?? '') === policy.expected.database,
    'database_mismatch',
  )

  const blocked = (key: string, candidate: string) => value(key)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(candidate)
  add(
    'binding.forbidden_target',
    !blocked('FORBIDDEN_NEON_PROJECT_IDS', policy.expected.project)
      && !blocked('FORBIDDEN_NEON_BRANCH_IDS', policy.expected.branch)
      && !blocked('FORBIDDEN_DB_HOSTS', parsed?.hostname ?? ''),
    'forbidden_target',
  )

  for (const name of capabilityNames) {
    const mode = policy.capabilities[name]
    // verified-disabled is policy metadata supplied by the caller. This pure
    // validator cannot prove that the capability is unreachable at runtime.
    checks.push({
      id: `capability.${name}`,
      status: mode === 'unknown' ? 'unknown' : 'pass',
      code: mode,
    })
    if (mode === 'required') checkRules(requirements[name])
  }

  return checks
}
