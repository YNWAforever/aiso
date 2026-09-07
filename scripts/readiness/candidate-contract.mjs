import { createHash } from 'node:crypto'

const capabilities = ['claims', 'ai', 'billing', 'email', 'scheduler']
const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const sqlPattern = /^[a-z_][a-z0-9_]{0,127}$/
const candidateKeys = ['teamId', 'projectId', 'deploymentId', 'commitSha', 'environment']
const databaseKeys = ['project', 'branch', 'role', 'database']
const core = ['DATABASE_URL', 'NEON_AUTH_BASE_URL', 'NEON_AUTH_COOKIE_SECRET', 'PUBLIC_SCAN_RATE_LIMIT_SECRET', 'NEXT_PUBLIC_APP_URL', 'VERCEL'].map(s => 'config.' + s)
const binding = ['EXPECTED_NEON_PROJECT_ID', 'EXPECTED_NEON_BRANCH_ID', 'EXPECTED_DB_ROLE', 'EXPECTED_DB_NAME', 'connection_role', 'connection_database', 'forbidden_target'].map(s => 'binding.' + s)
const optional = {
  claims: ['REPORT_SHARE_SECRET'], ai: ['OPENROUTER_API_KEY'],
  billing: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_BASIC', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ENTERPRISE'],
  email: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_TRIAL_FROM_EMAIL'], scheduler: ['CRON_SECRET'],
}
const configurationIds = [...core, ...binding, ...Object.values(optional).flat().map(s => 'config.' + s), ...capabilities.map(s => 'capability.' + s)]
const configCodes = ['valid', 'invalid', 'missing', 'expectation_mismatch', 'application_role_required', 'database_mismatch', 'forbidden_target', 'required', 'verified-disabled', 'unknown']
const requiredRuntime = ['configuration.core', 'candidate.identity', 'database.identity', 'database.read_only', 'auth.jwks', 'auth.anonymous_session']
const passCodes = {
  'candidate.identity': ['matched'], 'configuration.core': ['valid'], 'database.identity': ['matched'],
  'database.read_only': ['read_only'], 'database.relation': ['privilege_present', 'relation_present'],
  'auth.jwks': ['available'], 'auth.anonymous_session': ['anonymous'],
}
const runtimeCodes = ['matched','identity_unavailable','identity_mismatch','valid','invalid','dependency_failed','connected','connection_failed','read_only','read_only_unverified','relation_present','relation_missing','privilege_present','privilege_missing','available','unavailable','anonymous','session_present','malformed_response','timeout','probe_error']
const statuses = ['pass', 'fail', 'unknown']
const fail = () => { throw new Error('Candidate verification failed') }
const ensure = value => { if (!value) fail() }
const record = v => typeof v === 'object' && v !== null && !Array.isArray(v)
function exact(v, keys) { ensure(record(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k))) }
const matches = (v, pattern) => typeof v === 'string' && pattern.test(v)
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (record(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
export function validateCandidate(value) {
  exact(value, candidateKeys)
  ensure(['teamId','projectId','deploymentId'].every(k => matches(value[k], idPattern)))
  ensure(matches(value.commitSha, /^[a-f0-9]{40}$/) && ['preview','production'].includes(value.environment))
  // The CLI accepts immutable deployment IDs, never aliases or URLs.
  ensure(value.deploymentId.startsWith('dpl_') && value.teamId.startsWith('team_') && value.projectId.startsWith('prj_'))
  return value
}
export function validatePolicy(policy) {
  exact(policy, ['version', 'expectedDatabase', 'capabilities', 'relations']); ensure(policy.version === 1)
  exact(policy.expectedDatabase, databaseKeys)
  const db = policy.expectedDatabase
  ensure(matches(db.project,idPattern) && matches(db.branch,idPattern) && db.role === 'aeo_app' && matches(db.database,sqlPattern))
  exact(policy.capabilities, capabilities)
  ensure(Object.values(policy.capabilities).every(v => ['required','unknown','verified-disabled'].includes(v)))
  ensure(Array.isArray(policy.relations) && policy.relations.length <= 32)
  const names = new Set()
  for (const r of policy.relations) {
    exact(r,['schema','relation','privileges'])
    ensure(r.schema === 'public' && matches(r.relation,sqlPattern) && !names.has(r.relation)); names.add(r.relation)
    ensure(Array.isArray(r.privileges) && r.privileges.length > 0 && r.privileges.length <= 4 && new Set(r.privileges).size === r.privileges.length && r.privileges.every(p => ['SELECT','INSERT','UPDATE','DELETE'].includes(p)))
  }
  ensure(Buffer.byteLength(canonicalJson(policy)) <= 16384)
  return policy
}
export function hashPolicy(policy) { return createHash('sha256').update(canonicalJson(validatePolicy(policy))).digest('hex') }

export function verifyMetadata(metadata, expected) {
  ensure(record(metadata))
  ensure(metadata.ownerId === expected.teamId && metadata.projectId === expected.projectId && metadata.id === expected.deploymentId && metadata.readyState === 'READY')
  ensure(metadata.target === (expected.environment === 'preview' ? null : 'production'))
  const sources = [metadata.gitSource?.sha, metadata.meta?.githubCommitSha].filter(v => v !== undefined)
  ensure(sources.length > 0 && sources.every(s => s === expected.commitSha))
  ensure(typeof metadata.url === 'string')
  const raw = metadata.url
  // Authenticated canonical deployment url is authoritative; aliases are never consulted.
  ensure(/^(?:https:\/\/)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(raw))
  const url = new URL(raw.startsWith('https://') ? raw : 'https://' + raw)
  return url.origin
}
function aggregate(checks) {
  return checks.some(c => c.status === 'fail') ? 'fail' : !checks.length || checks.some(c => c.status === 'unknown') ? 'unknown' : 'pass'
}
function checks(value, ids, codes) {
  ensure(Array.isArray(value) && value.length <= 160)
  for (const c of value) ensure(record(c) && ids.includes(c.id) && statuses.includes(c.status) && codes.includes(c.code))
}
export function validateReport(report, { expected, policy, nonce, now }) {
  validateCandidate(expected); validatePolicy(policy)
  exact(report, ['schemaVersion','kind','enforced','productionReady','nonce','policyHash','startedAt','completedAt','expected','configuredTeamId','observed','observedDatabase','configuration','configurationStatus','runtimeStatus','checks'])
  ensure(report.schemaVersion === 1 && report.kind === 'runtime-readiness' && report.enforced === false && report.productionReady === false)
  ensure(matches(nonce,/^[a-f0-9]{32}$/) && report.nonce === nonce && report.policyHash === hashPolicy(policy))
  const times = [report.startedAt, report.completedAt].map(s => typeof s === 'string' ? Date.parse(s) : NaN)
  ensure(times.every((t,i) => Number.isFinite(t) && new Date(t).toISOString() === [report.startedAt,report.completedAt][i]))
  ensure(Number.isFinite(now) && times[0] <= times[1] && times[1] <= now && now - times[0] <= 30 * 60 * 1000 && times[1] - times[0] <= 20000)
  exact(report.expected,candidateKeys); ensure(canonicalJson(report.expected) === canonicalJson(expected))
  exact(report.observed,candidateKeys)
  ensure(report.configuredTeamId === expected.teamId && (report.observed.teamId === null || report.observed.teamId === expected.teamId))
  ensure(candidateKeys.filter(k => k !== 'teamId').every(k => report.observed[k] === expected[k]))
  exact(report.observedDatabase,databaseKeys)
  ensure(databaseKeys.every(k => report.observedDatabase[k] === null || matches(report.observedDatabase[k], ['role','database'].includes(k) ? sqlPattern : idPattern)))
  const config = report.configuration
  exact(config,['version','kind','enforced','productionReady','configurationStatus','checks'])
  ensure(config.version === 1 && config.kind === 'configuration-only' && config.enforced === false && config.productionReady === false)
  checks(config.checks, configurationIds, configCodes)
  const configIds = new Set()
  for (const c of config.checks) {
    exact(c,['id','status','code']); ensure(!configIds.has(c.id)); configIds.add(c.id)
    if (c.status === 'pass') ensure(['valid','required','verified-disabled'].includes(c.code))
    if (c.code === 'unknown') ensure(c.status === 'unknown')
  }
  const requiredConfig = [...core,...binding,...capabilities.map(c => 'capability.' + c),...capabilities.filter(c => policy.capabilities[c] === 'required').flatMap(c => optional[c].map(s => 'config.' + s))]
  ensure(requiredConfig.every(id => configIds.has(id)))
  ensure(config.configurationStatus === aggregate(config.checks) && report.configurationStatus === config.configurationStatus)
  checks(report.checks,Object.keys(passCodes),runtimeCodes)
  const seen = new Set()
  for (const c of report.checks) {
    const relation = c.id === 'database.relation'
    exact(c,relation ? ['id','status','code','policyIndex','privilege'] : ['id','status','code'])
    if (relation) ensure(Number.isInteger(c.policyIndex) && policy.relations[c.policyIndex]?.privileges.includes(c.privilege))
    const key = relation ? c.id + ':' + c.policyIndex + ':' + c.privilege : c.id
    ensure(!seen.has(key)); seen.add(key)
    if (c.status === 'pass') ensure(passCodes[c.id].includes(c.code))
    if (c.status !== 'pass') ensure(!['matched','valid','read_only','relation_present','privilege_present','available','anonymous'].includes(c.code))
    if (c.id === 'database.identity' && c.status === 'pass') ensure(databaseKeys.every(k => report.observedDatabase[k] === policy.expectedDatabase[k]))
    if (c.id === 'configuration.core' && c.status === 'pass') ensure(core.every(id => config.checks.find(c => c.id === id)?.status === 'pass'))
  }
  ensure(requiredRuntime.every(id => seen.has(id)))
  ensure(policy.relations.every((r,i) => r.privileges.every(p => seen.has('database.relation:' + i + ':' + p))))
  ensure(report.runtimeStatus === aggregate(report.checks))
  return JSON.parse(canonicalJson(report))
}
export function renderReport(report) {
  return ['# AISO runtime readiness', '', 'REPORT ONLY / NOT ENFORCED', 'Production readiness: unverified',
    'Configuration: ' + report.configurationStatus, 'Runtime: ' + report.runtimeStatus,
    'Nonce: ' + report.nonce, 'Policy hash: ' + report.policyHash,
    'Started: ' + report.startedAt, 'Completed: ' + report.completedAt,
    '', '## Expected candidate', ...Object.entries(report.expected).map(([k,v]) => '- ' + k + ': ' + v),
    '', '## Configured team (verified against control plane)', '- teamId: ' + report.configuredTeamId,
    '', '## Observed candidate', ...Object.entries(report.observed).map(([k,v]) => '- ' + k + ': ' + (v ?? 'unavailable')),
    '', '## Observed database', ...Object.entries(report.observedDatabase).map(([k,v]) => '- ' + k + ': ' + (v ?? 'unavailable')),
    '', '## Checks', ...[...report.configuration.checks,...report.checks].map(c => '- ' + c.id + ('policyIndex' in c ? ':' + c.policyIndex + ':' + c.privilege : '') + ': ' + c.status + ' (' + c.code + ')'), '',
  ].join('\n')
}
export const wireVocabulary = { configurationIds, configCodes, runtimeIds: Object.keys(passCodes), runtimeCodes, statuses }
