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

function assertSnapshotAllowlist(snapshot: DraftSnapshotV1): void {
  assertAllowedKeys(snapshot, ['schemaVersion', 'source', 'ruleVersion', 'evidence', 'limitations', 'titleKey', 'actionKey', 'args', 'locale', 'initialTitle', 'initialAction'], 'snapshot')
  assertAllowedKeys(snapshot.source, ['kind', 'id', 'checkKey'], 'snapshot source')
  if (!validNormalizedString(snapshot.ruleVersion, 80)
    || !validNormalizedString(snapshot.titleKey, 160)
    || !validNormalizedString(snapshot.actionKey, 160)
    || !validNormalizedString(snapshot.initialTitle, 160)
    || !validNormalizedString(snapshot.initialAction, 4_000)
    || !['en', 'zh-HK'].includes(snapshot.locale)) {
    throw new TypeError('Snapshot scalar fields must contain bounded normalized values')
  }
  assertRuleArgs(snapshot)
  assertStringArray(snapshot.limitations, 40, 160, 'snapshot limitations')

  const evidence = snapshot.evidence
  if (evidence.kind === 'pulse-metric') {
    assertAllowedKeys(evidence, ['kind', 'id', 'promptId', 'question', 'platform', 'scanWeek', 'recordedAt', 'result', 'hasAnswer', 'brandMentioned', 'provenance', 'limitations', 'answerDigest'], 'Pulse snapshot evidence')
    if (!validNormalizedString(evidence.id, 36)
      || (evidence.promptId !== null && !validNormalizedString(evidence.promptId, 36))
      || !validNormalizedString(evidence.question, 500)
      || !validNormalizedString(evidence.platform, 80)
      || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.scanWeek)
      || (evidence.recordedAt !== null && !validNormalizedString(evidence.recordedAt, 40))
      || evidence.result !== 'success' || evidence.hasAnswer !== true || evidence.brandMentioned !== false
      || evidence.provenance !== 'retained-pulse-metric' || !/^[a-f0-9]{64}$/.test(evidence.answerDigest)) {
      throw new TypeError('Pulse snapshot evidence contains invalid scalar values')
    }
    return
  }

  assertAllowedKeys(evidence, ['kind', 'scanId', 'recordedAt', 'checkKey', 'check', 'collection', 'collectedAt', 'requested', 'evaluated', 'final', 'scannerVersion', 'headlineMethod', 'pillarMethod', 'comparisonSignature', 'comparison', 'observations', 'limited', 'limitations', 'provenance'], 'scan snapshot evidence')
  assertAllowedKeys(evidence.check, ['applicability', 'version', 'collection', 'assessment', 'reason'], 'scan check evidence')
  assertStringArray(evidence.limitations, 40, 160, 'scan evidence limitations')
  assertAllowedKeys(evidence.requested, URL_KEYS, 'requested URL evidence')
  assertAllowedKeys(evidence.evaluated, URL_KEYS, 'evaluated URL evidence')
  if (evidence.final !== null) assertAllowedKeys(evidence.final, URL_KEYS, 'final URL evidence')
  assertAllowedKeys(evidence.comparison, ['scope', 'evaluatedOrigin', 'finalOrigin', 'industry', 'region', 'sitemapSource', 'urlPolicy', 'scannerVersion', 'checkVersions', 'headlineMethod', 'pillarMethod'], 'scan comparison evidence')
  assertAllowedKeys(evidence.comparison.checkVersions, Object.keys(CHECK_VERSIONS), 'scan check versions')
  for (const observation of evidence.observations) {
    assertAllowedKeys(observation, ['observedAt', 'provenance', 'collection', 'target', 'httpStatus', 'signals', 'check'], 'scan observation evidence')
    assertAllowedKeys(observation.target, URL_KEYS, 'scan observation target')
    assertAllowedKeys(observation.signals, ['mimeType', 'contentLength', 'lastModified', 'noindex', 'nofollow', 'nosnippet', 'noarchive'], 'scan observation signals')
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
  assertSnapshotAllowlist(snapshot)
  const serialized = canonicalJson(snapshot)
  if (Buffer.byteLength(serialized, 'utf8') > SNAPSHOT_BYTE_LIMIT) {
    throw new RangeError('Draft evidence snapshot exceeds 65536 bytes')
  }
  return serialized
}
