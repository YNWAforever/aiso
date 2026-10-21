import { resolve } from 'node:path'
import { offlineBuildEnvironment } from './build-offline.mjs'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const evidenceMode = 'LOCAL_REAL_AUTH_ENGINE_AND_POSTGRES_WITH_SYNTHETIC_SCAN'

export function parseLocalAuthScenario(args) {
  const values = args.filter(value => value.startsWith('--scenario='))
  if (!values.length) return 'first-value'
  if (values.length !== 1 || !['first-value', 'brand-isolation', 'auth-rate-limit', 'login-rate-limit', 'account-unlock-rate-limit', 'report-recovery', 'report-list', 'report-multi', 'report-conflict', 'report-task'].includes(values[0].slice(11))) {
    throw new Error('LOCAL_AUTH_SCENARIO_INVALID')
  }
  return values[0].slice(11)
}

export function verifyReportRecoveryFixture(config, identity, email) {
  let expected
  try { expected = runSpec(config.runId, config.imageId) }
  catch { throw new Error('LOCAL_AUTH_REPORT_TARGET') }
  if (!['report-recovery', 'report-list', 'report-multi', 'report-conflict', 'report-task'].includes(config.scenario) || config.mode !== evidenceMode ||
      config.containerVerified !== true || !/^[a-f0-9]{64}$/.test(config.containerId ?? '') ||
      config.dbHost !== '127.0.0.1' || config.database !== expected.database ||
      !uuid.test(identity?.id ?? '') || !uuid.test(identity?.account_id ?? '') ||
      typeof email !== 'string' || !/^[a-z0-9-]+@fixture-aiso\.example$/.test(email) ||
      !email.endsWith(`-${config.runId}@fixture-aiso.example`)) throw new Error('LOCAL_AUTH_REPORT_TARGET')
  return identity.account_id
}

export function verifyMultiBrandFixture(config, identity, email) {
  let expected
  try { expected = runSpec(config.runId, config.imageId) }
  catch { throw new Error('LOCAL_AUTH_MULTI_BRAND_TARGET') }
  if (config.scenario !== 'brand-isolation' || config.mode !== evidenceMode ||
      config.containerVerified !== true || !/^[a-f0-9]{64}$/.test(config.containerId ?? '') ||
      config.dbHost !== '127.0.0.1' || config.database !== expected.database ||
      !uuid.test(identity?.id ?? '') || !uuid.test(identity?.account_id ?? '') ||
      typeof email !== 'string' || !/^[a-z0-9-]+@fixture-aiso\.example$/.test(email) ||
      !email.endsWith(`-${config.runId}@fixture-aiso.example`)) {
    throw new Error('LOCAL_AUTH_MULTI_BRAND_TARGET')
  }
  return identity.account_id
}

export function verifyLocalDockerContext(metadata) {
  if (!metadata?.Endpoints?.docker?.Host?.startsWith('npipe://')) {
    throw new Error('LOCAL_AUTH_DOCKER_MUST_BE_LOCAL')
  }
  return true
}

export function runSpec(runId, imageId) {
  if (!uuid.test(runId)) throw new Error('LOCAL_AUTH_RUN_ID')
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('LOCAL_AUTH_IMAGE_ID')
  const suffix = runId.replaceAll('-', '')
  return {
    runId, imageId, database: `aiso_auth_${suffix}`,
    containerName: `aiso-local-auth-${runId}`,
    projectId: `local-aiso-auth-${runId}`, branchId: `local-disposable-${runId}`,
    labels: { 'com.aiso.local-auth.run': runId, 'com.aiso.local-auth.purpose': 'disposable-auth-browser' },
  }
}

export function artifactDirectory(root, runId, scenario = 'first-value') {
  runSpec(runId, `sha256:${'0'.repeat(64)}`)
  return resolve(root, 'artifacts', scenario === 'report-task' ? 'report-task-local-20261019'
    : scenario === 'report-conflict' ? 'report-conflict-local-20261019'
    : scenario === 'report-multi' ? 'report-multi-local-20261019'
    : scenario === 'report-list' ? 'report-list-local-20261019'
    : scenario === 'report-recovery' ? 'report-local-integration-20261019'
      : 'first-value-flow-20261017', `local-auth-${runId}`)
}

export function verifyContainer(value, spec, returnedId) {
  const ports = value?.NetworkSettings?.Ports?.['5432/tcp']
  const labels = value?.Config?.Labels ?? {}
  if (!/^[a-f0-9]{64}$/.test(returnedId) || value?.Id !== returnedId ||
      value?.Image !== spec.imageId || Object.entries(spec.labels).some(([key, expected]) => labels[key] !== expected) ||
      (value?.HostConfig?.Binds?.length ?? 0) !== 0 || !Array.isArray(ports) || ports.length !== 1 ||
      ports[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(ports[0].HostPort) ||
      Number(ports[0].HostPort) < 1024 || Number(ports[0].HostPort) > 65535) {
    throw new Error('LOCAL_AUTH_CONTAINER_IDENTITY')
  }
  return { host: '127.0.0.1', port: Number(ports[0].HostPort) }
}

export function verifyDatabase(row, spec, role) {
  if (row?.project_id !== spec.projectId || row?.branch_id !== spec.branchId ||
      row?.database !== spec.database || row?.role !== role) throw new Error('LOCAL_AUTH_DATABASE_IDENTITY')
  return true
}

export function verifyOwnedFixtureBrand(brand, identity, clientId) {
  if (!uuid.test(clientId ?? '') || brand?.id !== clientId || !identity?.id ||
      !identity.account_id || brand.account_id !== identity.account_id ||
      brand.domain !== 'fixture-aiso.example') throw new Error('LOCAL_AUTH_EXISTING_OWNED_BRAND_REQUIRED')
  return brand.id
}

export function allowLocalUrl(value, allowedOrigins) {
  let url
  try { url = new URL(value) } catch { throw new Error('LOCAL_AUTH_NETWORK_DENIED') }
  if (url.hostname !== '127.0.0.1' || url.username || url['pass' + 'word'] ||
      !allowedOrigins.includes(url.origin) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('LOCAL_AUTH_NETWORK_DENIED')
  }
  return true
}

export function localEnvironment(ambient, dotenv = []) {
  const allowed = /^(path|systemroot|windir|comspec|pathext|temp|tmp|userprofile|localappdata|appdata|programfiles|programfiles\(x86\)|programdata|number_of_processors|processor_architecture)$/i
  const safe = Object.fromEntries(Object.entries(ambient).filter(([key]) => allowed.test(key)))
  const env = offlineBuildEnvironment(safe, dotenv)
  env.CI = ''
  env.E2E_FIXTURE_MODE = ''
  env.START_DEV_SERVER = ''
  env.FEATURE_PULSE_ATTEMPTS = 'false'
  env.NEXT_TELEMETRY_DISABLED = '1'
  env.NODE_OPTIONS = ''
  return env
}

export function redactLocalAuth(value, secrets = []) {
  let text = String(value)
  for (const secret of secrets.filter(value => typeof value === 'string' && value.length > 5)) {
    text = text.split(secret).join('[REDACTED]')
    text = text.split(encodeURIComponent(secret)).join('[REDACTED]')
  }
  return text
    .replace(new RegExp('post' + 'gres(?:ql)?:\\/\\/[^\\s"\'<>]+', 'gi'), '[REDACTED_DSN]')
    .replace(/(^|\n)\s*(?:set-cookie|cookie|authorization):[^\r\n]*/gi, '$1[REDACTED_HEADER]')
    .replace(/(__Secure-neon-auth\.[\w.-]+\s*[=:]\s*)[^;\s"',}]+/g, '$1[REDACTED]')
    .replace(/([?&](?:token|neon_auth_session_verifier|code|state)=)[^&\s"'<>]*/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
}
