import { CHECK_VERSIONS } from '@/lib/scan-evidence-versions'
import type { VersionDetail, VersionSummary } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const COLLECTION = ['complete', 'partial', 'blocked', 'failed', 'unsupported', 'unknown']
const ASSESSMENT = ['pass', 'warn', 'fail', 'not-applicable', 'not-verifiable']
const CHECK_REASONS = ['provider-fallback', 'inferred-only', 'no-input', 'fetch-failed', 'parse-failed']

function invalid(): never { throw new Error('CHANGE_SET_UNAVAILABLE') }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string') invalid()
}
function nonempty(value: unknown): asserts value is string {
  text(value)
  if (!value.length) invalid()
}
function nullableText(value: unknown): void { if (value !== null) text(value) }
function boolean(value: unknown): void { if (typeof value !== 'boolean') invalid() }
function integer(value: unknown, minimum: number): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid()
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
}
function hash(value: unknown): void { if (typeof value !== 'string' || !HASH.test(value)) invalid() }
function oneOf(value: unknown, choices: readonly string[]): void {
  if (typeof value !== 'string' || !choices.includes(value)) invalid()
}
function array(value: unknown, check: (entry: unknown) => void): void {
  if (!Array.isArray(value)) invalid()
  // Unlike Array.every, iteration also visits holes in non-JSON input.
  for (const entry of value) check(entry)
}
function strings(value: unknown): void { array(value, text) }
function checkKey(value: unknown): void {
  if (typeof value !== 'string' || !Object.hasOwn(CHECK_VERSIONS, value)) invalid()
}
function timestamp(value: unknown): void {
  text(value)
  if (!Number.isFinite(Date.parse(value))) invalid()
}
function actor(value: unknown): Record<string, unknown> {
  const a = record(value)
  uuid(a.profileId)
  nullableText(a.displayName)
  oneOf(a.role, ['account_member', 'account_approver', 'platform_admin'])
  return a
}
function summary(value: unknown, workItemId: string): Record<string, unknown> {
  const v = record(value)
  if (v.schemaVersion !== 1 && v.schemaVersion !== 2) invalid()
  uuid(v.id)
  uuid(v.workItemId)
  if (v.workItemId !== workItemId) invalid()
  integer(v.versionNumber, 1)
  integer(v.draftRevision, 1)
  hash(v.contentHash)
  actor(v.submittedBy)
  timestamp(v.submittedAt)
  const capabilities = record(v.capabilities)
  boolean(capabilities.canDecide)
  if (v.decision !== null) {
    const d = record(v.decision)
    oneOf(d.decision, ['approved', 'changes_requested'])
    nonempty(d.reason)
    if (actor(d.decidedBy).role !== 'account_approver') invalid()
    timestamp(d.decidedAt)
    if (capabilities.canDecide !== false) invalid()
  }
  return v
}
function url(value: unknown): void {
  const u = record(value)
  nullableText(u.origin)
  for (const key of ['pathRedacted', 'queryRedacted', 'fragmentRedacted', 'originNormalized']) boolean(u[key])
}
function observation(value: unknown): void {
  const o = record(value)
  nullableText(o.observedAt)
  if (o.provenance !== null && o.provenance !== 'validated-fetch') invalid()
  oneOf(o.collection, COLLECTION)
  url(o.target)
  if (o.httpStatus !== null) {
    integer(o.httpStatus, 100)
    if ((o.httpStatus as number) > 599) invalid()
  }
  if (o.check !== null && o.check !== 'page' && o.check !== 'sitemap') checkKey(o.check)
  const signals = record(o.signals)
  for (const value of Object.values(signals)) {
    if (typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) invalid()
  }
}
function scanEvidence(e: Record<string, unknown>): void {
  nonempty(e.scanId)
  nullableText(e.recordedAt)
  checkKey(e.checkKey)
  const check = record(e.check)
  oneOf(check.applicability, ['applicable', 'not-applicable', 'not-verifiable'])
  nonempty(check.version)
  oneOf(check.collection, COLLECTION)
  oneOf(check.assessment, ASSESSMENT)
  if (check.reason !== undefined) oneOf(check.reason, CHECK_REASONS)
  oneOf(e.collection, COLLECTION)
  nullableText(e.collectedAt)
  url(e.requested)
  url(e.evaluated)
  if (e.final !== null) url(e.final)
  for (const key of ['scannerVersion', 'headlineMethod', 'pillarMethod']) nonempty(e[key])
  hash(e.comparisonSignature)
  const comparison = record(e.comparison)
  if (comparison.scope !== 'single-origin-page') invalid()
  nullableText(comparison.evaluatedOrigin)
  nullableText(comparison.finalOrigin)
  for (const key of ['industry', 'region', 'urlPolicy', 'scannerVersion', 'headlineMethod', 'pillarMethod']) nonempty(comparison[key])
  oneOf(comparison.sitemapSource, ['caller', 'fetched', 'unknown'])
  const versions = record(comparison.checkVersions)
  for (const key of Object.keys(CHECK_VERSIONS)) nonempty(versions[key])
  array(e.observations, observation)
  boolean(e.limited)
  if (e.provenance !== 'validated-scan-evidence') invalid()
  strings(e.limitations)
}
function snapshot(value: unknown): void {
  const s = record(value)
  if (s.schemaVersion !== 1) invalid()
  const source = record(s.source)
  oneOf(source.kind, ['pulse-metric', 'scan-check'])
  // Historical source IDs are opaque strings, not necessarily UUIDs.
  nonempty(source.id)
  if (source.checkKey !== undefined) checkKey(source.checkKey)
  oneOf(s.ruleVersion, ['pulse-brand-absent.v1', 'scan-check-gap.v1'])
  for (const key of ['titleKey', 'actionKey', 'initialTitle', 'initialAction']) nonempty(s[key])
  oneOf(s.locale, ['en', 'zh-HK'])
  strings(s.limitations)
  const args = record(s.args)
  for (const value of Object.values(args)) text(value)
  if (s.ruleVersion === 'pulse-brand-absent.v1') {
    text(args.question)
    text(args.platform)
  } else {
    checkKey(args.checkKey)
    oneOf(args.assessment, ['warn', 'fail'])
  }
  const e = record(s.evidence)
  if (e.kind === 'pulse-metric') {
    nonempty(e.id)
    nullableText(e.promptId)
    text(e.question)
    text(e.platform)
    text(e.scanWeek)
    nullableText(e.recordedAt)
    if (e.result !== 'success' || e.hasAnswer !== true || e.brandMentioned !== false || e.provenance !== 'retained-pulse-metric') invalid()
    hash(e.answerDigest)
    strings(e.limitations)
  } else if (e.kind === 'scan-check') {
    scanEvidence(e)
  } else invalid()
}
function editSpec(value: unknown): void {
  const s = record(value)
  if (s.schemaVersion !== 1) invalid()
  text(s.targetUrl)
  if (s.kind === 'jsonld' || s.kind === 'jsonld_remove') {
    oneOf(s.schemaType, ['FAQPage', 'Organization', 'LocalBusiness'])
    record(s.payload)
  } else if (s.kind === 'meta') {
    nullableText(s.title)
    nullableText(s.description)
  } else if (s.kind === 'llms_txt') {
    text(s.content)
  } else invalid()
}
function validation(value: unknown): void {
  const v = record(value)
  if (v.policyVersion !== 'change-set-review.v1') invalid()
  const codes = ['text', 'locale', 'evidence', 'content_size']
  if (!Array.isArray(v.checks) || v.checks.length !== codes.length) invalid()
  const seen = new Set<string>()
  array(v.checks, entry => {
    const check = record(entry)
    oneOf(check.code, codes)
    if (check.status !== 'pass' || seen.has(check.code as string)) invalid()
    seen.add(check.code as string)
  })
}

/** Decode the existing list envelope without sorting, dropping extras or inferring latest from a page. */
export function parseVersionPage(value: unknown, workItemId: string): {
  versions: VersionSummary[]; nextCursor: string | null; latestVersionId: string | null
} {
  uuid(workItemId)
  const page = record(value)
  array(page.versions, entry => { summary(entry, workItemId) })
  if (page.nextCursor !== null) nonempty(page.nextCursor)
  if (page.latestVersionId !== null) uuid(page.latestVersionId)
  return page as { versions: VersionSummary[]; nextCursor: string | null; latestVersionId: string | null }
}

/**
 * Decode an unwrapped public version. The server re-freezes persisted content;
 * this adapter checks transport shape and requested identity, not cryptographic
 * provenance, authorization, current evidence eligibility or brand ownership.
 * Never normalize, hash, sort or deduplicate saved content here.
 */
export function parseVersionDetail(
  value: unknown,
  workItemId: string,
  expected?: { id?: string; contentHash?: string; draftRevision?: number },
): VersionDetail {
  uuid(workItemId)
  const v = summary(value, workItemId)
  if (expected?.id !== undefined && v.id !== expected.id) invalid()
  if (expected?.contentHash !== undefined && v.contentHash !== expected.contentHash) invalid()
  if (expected?.draftRevision !== undefined && v.draftRevision !== expected.draftRevision) invalid()
  nonempty(v.title)
  nonempty(v.action)
  text(v.notes)
  oneOf(v.locale, ['en', 'zh-HK'])
  if (v.schemaVersion === 1) snapshot(v.evidenceSnapshot)
  else {
    if (!Array.isArray(v.evidenceSnapshots) || v.evidenceSnapshots.length === 0) invalid()
    array(v.evidenceSnapshots, snapshot)
  }
  if (v.editSpec !== undefined) editSpec(v.editSpec)
  validation(v.validation)
  return v as VersionDetail
}
