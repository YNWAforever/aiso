import { createHash } from 'node:crypto'
import { CHECK_VERSIONS } from '@/lib/scan-evidence'
import type { DraftSnapshotV1, SourceRef } from '@/lib/opportunities/types'

const SNAPSHOT_BYTE_LIMIT = 65_536

function assertAllowedKeys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const unexpected = Object.keys(value).find(key => !allowed.includes(key))
  if (unexpected !== undefined) throw new TypeError(`${label} contains unsupported field: ${unexpected}`)
}

const URL_KEYS = ['origin', 'pathRedacted', 'queryRedacted', 'fragmentRedacted', 'originNormalized'] as const

function validNormalizedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.normalize('NFC').trim() && Array.from(value).length <= maximum
}

function assertStringArray(value: unknown, maximumItems: number, maximumCharacters: number, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maximumItems || value.some(item => !validNormalizedString(item, maximumCharacters))) {
    throw new TypeError(`${label} must contain bounded normalized strings`)
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
function assertRuleArgs(snapshot: DraftSnapshotV1): void {
  if (snapshot.ruleVersion === 'pulse-brand-absent.v1') {
    assertAllowedKeys(snapshot.args, ['question', 'platform'], 'Pulse rule arguments')
    if (!validNormalizedString(snapshot.args.question, 500) || !validNormalizedString(snapshot.args.platform, 80)) {
      throw new TypeError('Pulse rule arguments must contain bounded normalized strings')
    }
    return
  }
  if (snapshot.ruleVersion === 'scan-check-gap.v1') {
    assertAllowedKeys(snapshot.args, ['checkKey', 'assessment'], 'scan rule arguments')
    if (!Object.hasOwn(CHECK_VERSIONS, snapshot.args.checkKey) || !['warn', 'fail'].includes(snapshot.args.assessment)) {
      throw new TypeError('Scan rule arguments must name an eligible check assessment')
    }
    return
  }
  throw new TypeError('Unsupported snapshot rule version')
}

const COLLECTION_STATES = ['complete', 'partial', 'blocked', 'failed', 'unsupported', 'unknown'] as const
const ASSESSMENTS = ['pass', 'warn', 'fail', 'not-applicable', 'not-verifiable'] as const
const APPLICABILITY = ['applicable', 'not-applicable', 'not-verifiable'] as const
const CHECK_REASONS = ['provider-fallback', 'inferred-only', 'no-input', 'fetch-failed', 'parse-failed'] as const
const INDUSTRIES: readonly string[] = ['finance', 'medical', 'legal', 'technology', 'retail_ecommerce', 'travel_hospitality', 'education', 'real_estate', 'manufacturing', 'media_entertainment', 'energy_utilities', 'general_b2b', 'general_b2c', 'unknown'] as const
const REGIONS: readonly string[] = ['HK', 'TW', 'SG', 'JP', 'KR', 'US', 'UK', 'EU', 'AU', 'CA', 'global', 'unknown'] as const

function validNullableString(value: unknown, maximum: number): boolean {
  return value === null || validNormalizedString(value, maximum)
}

function assertUrl(value: unknown, label: string): void {
  assertAllowedKeys(value, URL_KEYS, label)
  if (!validNullableString(value.origin, 300)
    || typeof value.pathRedacted !== 'boolean' || typeof value.queryRedacted !== 'boolean'
    || typeof value.fragmentRedacted !== 'boolean' || typeof value.originNormalized !== 'boolean') {
    throw new TypeError(`${label} contains invalid scalar values`)
  }
}

function assertSignals(value: unknown): void {
  const keys = ['mimeType', 'contentLength', 'lastModified', 'noindex', 'nofollow', 'nosnippet', 'noarchive'] as const
  assertAllowedKeys(value, keys, 'scan observation signals')
  if (value.mimeType !== undefined && (typeof value.mimeType !== 'string' || !['text/html', 'text/plain', 'application/json', 'application/xml', 'text/xml', 'application/xhtml+xml'].includes(value.mimeType))) throw new TypeError('Invalid mimeType signal')
  if (value.contentLength !== undefined && (typeof value.contentLength !== 'number' || !Number.isSafeInteger(value.contentLength) || value.contentLength < 0)) throw new TypeError('Invalid contentLength signal')
  if (value.lastModified !== undefined && !validNormalizedString(value.lastModified, 40)) throw new TypeError('Invalid lastModified signal')
  for (const key of ['noindex', 'nofollow', 'nosnippet', 'noarchive'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new TypeError(`Invalid ${key} signal`)
  }
}

function assertSnapshotAllowlist(snapshot: DraftSnapshotV1): void {
  assertAllowedKeys(snapshot, ['schemaVersion', 'source', 'ruleVersion', 'evidence', 'limitations', 'titleKey', 'actionKey', 'args', 'locale', 'initialTitle', 'initialAction'], 'snapshot')
  assertAllowedKeys(snapshot.source, ['kind', 'id', 'checkKey'], 'snapshot source')
  if (snapshot.schemaVersion !== 1 || !validNormalizedString(snapshot.source.id, 36)) throw new TypeError('Invalid snapshot identity')
  if (!validNormalizedString(snapshot.ruleVersion, 80) || !validNormalizedString(snapshot.titleKey, 160)
    || !validNormalizedString(snapshot.actionKey, 160) || !validNormalizedString(snapshot.initialTitle, 160)
    || !validNormalizedString(snapshot.initialAction, 4_000) || !['en', 'zh-HK'].includes(snapshot.locale)) {
    throw new TypeError('Snapshot scalar fields must contain bounded normalized values')
  }
  assertRuleArgs(snapshot)
  assertStringArray(snapshot.limitations, 40, 160, 'snapshot limitations')

  const evidence = snapshot.evidence
  if (evidence.kind === 'pulse-metric') {
    if (snapshot.ruleVersion !== 'pulse-brand-absent.v1' || snapshot.titleKey !== 'review-question-coverage' || snapshot.actionKey !== 'review-question-coverage' || snapshot.source.kind !== 'pulse-metric' || Object.hasOwn(snapshot.source, 'checkKey')) throw new TypeError('Pulse source identity does not match evidence')
    assertAllowedKeys(evidence, ['kind', 'id', 'promptId', 'question', 'platform', 'scanWeek', 'recordedAt', 'result', 'hasAnswer', 'brandMentioned', 'provenance', 'limitations', 'answerDigest'], 'Pulse snapshot evidence')
    if (!validNormalizedString(evidence.id, 36) || snapshot.source.id !== evidence.id
      || (evidence.promptId !== null && !validNormalizedString(evidence.promptId, 36))
      || !validNormalizedString(evidence.question, 500) || !validNormalizedString(evidence.platform, 80)
      || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.scanWeek) || !validNullableString(evidence.recordedAt, 40)
      || evidence.result !== 'success' || evidence.hasAnswer !== true || evidence.brandMentioned !== false
      || evidence.provenance !== 'retained-pulse-metric' || !/^[a-f0-9]{64}$/.test(evidence.answerDigest)) {
      throw new TypeError('Pulse snapshot evidence contains invalid scalar values')
    }
    assertStringArray(evidence.limitations, 40, 160, 'Pulse evidence limitations')
    if (snapshot.args.question !== evidence.question || snapshot.args.platform !== evidence.platform
      || !sameStrings(snapshot.limitations, evidence.limitations)) throw new TypeError('Pulse rule arguments do not match evidence')
    return
  }

  assertAllowedKeys(evidence, ['kind', 'scanId', 'recordedAt', 'checkKey', 'check', 'collection', 'collectedAt', 'requested', 'evaluated', 'final', 'scannerVersion', 'headlineMethod', 'pillarMethod', 'comparisonSignature', 'comparison', 'observations', 'limited', 'limitations', 'provenance'], 'scan snapshot evidence')
  if (snapshot.ruleVersion !== 'scan-check-gap.v1' || snapshot.titleKey !== 'review-check' || snapshot.actionKey !== 'review-check' || snapshot.source.kind !== 'scan-check' || typeof snapshot.source.checkKey !== 'string' || !Object.hasOwn(CHECK_VERSIONS, snapshot.source.checkKey)
    || snapshot.source.checkKey !== evidence.checkKey || snapshot.source.id !== evidence.scanId) throw new TypeError('Scan source identity does not match evidence')
  if (!validNormalizedString(evidence.scanId, 36) || !validNullableString(evidence.recordedAt, 40)
    || !Object.hasOwn(CHECK_VERSIONS, evidence.checkKey) || !COLLECTION_STATES.includes(evidence.collection)
    || !validNullableString(evidence.collectedAt, 40) || !validNormalizedString(evidence.scannerVersion, 80)
    || !validNormalizedString(evidence.headlineMethod, 80) || !validNormalizedString(evidence.pillarMethod, 80)
    || !/^[a-f0-9]{64}$/.test(evidence.comparisonSignature) || typeof evidence.limited !== 'boolean'
    || evidence.provenance !== 'validated-scan-evidence' || !Array.isArray(evidence.observations) || evidence.observations.length > 40) {
    throw new TypeError('Scan snapshot evidence contains invalid scalar values')
  }
  assertAllowedKeys(evidence.check, ['applicability', 'version', 'collection', 'assessment', 'reason'], 'scan check evidence')
  if (snapshot.args.checkKey !== evidence.checkKey || snapshot.args.assessment !== evidence.check.assessment
    || evidence.check.applicability !== 'applicable' || evidence.check.collection !== 'complete'
    || !['warn', 'fail'].includes(evidence.check.assessment) || evidence.check.version !== CHECK_VERSIONS[evidence.checkKey]) {
    throw new TypeError('Scan rule arguments and selected check must describe the same eligible evidence')
  }
  if (!APPLICABILITY.includes(evidence.check.applicability) || !validNormalizedString(evidence.check.version, 80)
    || !COLLECTION_STATES.includes(evidence.check.collection) || !ASSESSMENTS.includes(evidence.check.assessment)
    || (evidence.check.reason !== undefined && !CHECK_REASONS.includes(evidence.check.reason))) throw new TypeError('Invalid scan check evidence')
  assertStringArray(evidence.limitations, 40, 160, 'scan evidence limitations')
  assertUrl(evidence.requested, 'requested URL evidence')
  assertUrl(evidence.evaluated, 'evaluated URL evidence')
  if (evidence.final !== null) assertUrl(evidence.final, 'final URL evidence')
  assertAllowedKeys(evidence.comparison, ['scope', 'evaluatedOrigin', 'finalOrigin', 'industry', 'region', 'sitemapSource', 'urlPolicy', 'scannerVersion', 'checkVersions', 'headlineMethod', 'pillarMethod'], 'scan comparison evidence')
  if (evidence.comparison.scope !== 'single-origin-page' || !validNullableString(evidence.comparison.evaluatedOrigin, 300)
    || !validNullableString(evidence.comparison.finalOrigin, 300) || !INDUSTRIES.includes(evidence.comparison.industry)
    || !REGIONS.includes(evidence.comparison.region) || !['caller', 'fetched', 'unknown'].includes(evidence.comparison.sitemapSource)
    || !validNormalizedString(evidence.comparison.urlPolicy, 80) || !validNormalizedString(evidence.comparison.scannerVersion, 80)
    || !validNormalizedString(evidence.comparison.headlineMethod, 80) || !validNormalizedString(evidence.comparison.pillarMethod, 80)) throw new TypeError('Invalid scan comparison evidence')
  assertAllowedKeys(evidence.comparison.checkVersions, Object.keys(CHECK_VERSIONS), 'scan check versions')
  if (Object.keys(evidence.comparison.checkVersions).length !== Object.keys(CHECK_VERSIONS).length
    || Object.entries(CHECK_VERSIONS).some(([key, version]) => evidence.comparison.checkVersions[key as keyof typeof CHECK_VERSIONS] !== version)) throw new TypeError('Invalid scan check versions')
  if (evidence.scannerVersion !== evidence.comparison.scannerVersion
    || evidence.headlineMethod !== evidence.comparison.headlineMethod
    || evidence.pillarMethod !== evidence.comparison.pillarMethod
    || evidence.evaluated.origin !== evidence.comparison.evaluatedOrigin
    || (evidence.final?.origin ?? null) !== evidence.comparison.finalOrigin
    || !sameStrings(snapshot.limitations, evidence.limitations)) throw new TypeError('Scan snapshot provenance fields are inconsistent')
  for (const observation of evidence.observations) {
    assertAllowedKeys(observation, ['observedAt', 'provenance', 'collection', 'target', 'httpStatus', 'signals', 'check'], 'scan observation evidence')
    if (!validNullableString(observation.observedAt, 40) || ![null, 'validated-fetch'].includes(observation.provenance)
      || !COLLECTION_STATES.includes(observation.collection)
      || (observation.httpStatus !== null && (typeof observation.httpStatus !== 'number' || !Number.isInteger(observation.httpStatus) || observation.httpStatus < 100 || observation.httpStatus > 599))
      || (observation.check !== null && observation.check !== 'page' && observation.check !== 'sitemap' && !Object.hasOwn(CHECK_VERSIONS, observation.check))) throw new TypeError('Invalid scan observation evidence')
    assertUrl(observation.target, 'scan observation target')
    assertSignals(observation.signals)
  }
}

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical values require finite numbers')
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== 'object') throw new TypeError('Unsupported canonical value')
  if (ancestors.has(value)) throw new TypeError('Cyclic canonical value')

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('Sparse arrays are unsupported')
        output.push(canonicalize(value[index], ancestors))
      }
      return output
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Only plain objects are supported')
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('Symbol keys are unsupported')

    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(input).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
      output[key] = canonicalize(input[key], ancestors)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()))
}

export function fingerprintEvidence(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function opportunityKey(ruleVersion: string, source: SourceRef): string {
  return `${ruleVersion}:${source.kind}:${source.id}:${source.checkKey ?? ''}`
}

export function serializeDraftSnapshot(snapshot: DraftSnapshotV1): string {
  const serialized = canonicalJson(snapshot)
  if (Buffer.byteLength(serialized, 'utf8') > SNAPSHOT_BYTE_LIMIT) {
    throw new RangeError('Draft evidence snapshot exceeds 65536 bytes')
  }
  assertSnapshotAllowlist(snapshot)
  return serialized
}
