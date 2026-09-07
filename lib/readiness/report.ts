import {
  configurationCheckCodes,
  configurationCheckIds,
  configurationCheckStatuses,
  type ConfigCheck,
} from './config'

const invalidCheckError = 'Invalid configuration check'
const checkIds = new Set<string>(configurationCheckIds)
const checkStatuses = new Set<string>(configurationCheckStatuses)
const checkCodes = new Set<string>(configurationCheckCodes)

type ConfigurationStatus = ConfigCheck['status']

export type ConfigurationReport = {
  version: 1
  kind: 'configuration-only'
  enforced: false
  productionReady: false
  configurationStatus: ConfigurationStatus
  checks: ConfigCheck[]
}

function validateCheck(check: unknown): asserts check is ConfigCheck {
  if (
    typeof check !== 'object'
    || check === null
    || !('id' in check)
    || !('status' in check)
    || !('code' in check)
    || typeof check.id !== 'string'
    || typeof check.status !== 'string'
    || typeof check.code !== 'string'
    || !checkIds.has(check.id)
    || !checkStatuses.has(check.status)
    || !checkCodes.has(check.code)
  ) {
    throw new Error(invalidCheckError)
  }
}

function safeCheck(check: unknown): ConfigCheck {
  validateCheck(check)
  return { id: check.id, status: check.status, code: check.code }
}

export function buildConfigurationReport(checks: readonly ConfigCheck[]): ConfigurationReport {
  const safe = checks.map(safeCheck)
  const configurationStatus = safe.some((check) => check.status === 'fail')
    ? 'fail'
    : safe.length === 0 || safe.some((check) => check.status === 'unknown')
      ? 'unknown'
      : 'pass'

  return {
    version: 1,
    kind: 'configuration-only',
    enforced: false,
    productionReady: false,
    configurationStatus,
    checks: safe,
  }
}

export function renderConfigurationReport(report: ConfigurationReport): string {
  const checks = report.checks.map(safeCheck)

  return [
    '# AISO configuration readiness',
    '',
    'REPORT ONLY / NOT ENFORCED',
    '',
    `Configuration: ${report.configurationStatus}`,
    'Production readiness: unverified',
    '',
    ...checks.map((check) => `- ${check.id}: ${check.status} (${check.code})`),
    '',
  ].join('\n')
}