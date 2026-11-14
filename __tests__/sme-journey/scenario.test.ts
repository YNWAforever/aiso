import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { freezeReview } from '@/lib/change-sets/validation'
import { parseVersionDetail, parseVersionPage } from '@/lib/change-sets/read-view'
import { fingerprintEvidence, serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { parseCreateDraft } from '@/lib/work-items/schema'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { db } from '@/lib/db'
import { createJourneyScenario, freezeJourneyDraft } from './scenario.node'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: vi.fn(() => { throw new Error('Scenario must not open a database') }) }))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Scenario must not make a network request') }))
})
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
  expect(db).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

// Independent canonical hash witness: do not merely compare a mocked hash or DTO.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

for (const lang of ['en', 'zh-HK'] as const) describe(`genuine controlled journey packet (${lang})`, () => {
  it('builds friendly genuine scan-derived evidence and an editable saved draft', () => {
    const scenario = createJourneyScenario(lang), draft = scenario.draft
    expect(scenario.brandName).toBe(lang === 'en' ? 'Harbour Tea' : '海港茶舖')
    expect(draft.title).toContain(scenario.brandName)
    expect(draft.locale).toBe(lang)
    expect(draft.id).toBe(scenario.ids.itemId)
    expect(draft.clientId).toBe(scenario.ids.clientId)
    expect(draft.status).toBe('draft')
    expect(draft.revision).toBe(1)
    const suggestion = scenario.opportunities.suggestions[0]
    expect(scenario.opportunities.suggestions).toHaveLength(1)
    expect(suggestion).toMatchObject({ source: { kind: 'scan-check', checkKey: 'c4_structured_data' },
      ruleVersion: 'scan-check-gap.v1', savedDraftId: draft.id, savedState: 'saved', saveAvailability: 'available',
      evidence: { kind: 'scan-check', provenance: 'validated-scan-evidence', check: { collection: 'complete', assessment: 'warn' } } })
    expect(draft.evidenceSnapshot.evidence).toEqual(suggestion.evidence)
    expect(draft.evidenceSnapshot.source).toEqual(suggestion.source)
    expect(draft.evidenceSnapshot.locale).toBe(lang)
    expect(JSON.parse(serializeDraftSnapshot(draft.evidenceSnapshot))).toEqual(draft.evidenceSnapshot)
    expect(parseDraftEdit({ title: draft.title, action: draft.action, notes: draft.notes, expectedRevision: 1 }))
      .toEqual({ title: draft.title, action: draft.action, notes: draft.notes, expectedRevision: 1 })
    expect(parseCreateDraft({ source: suggestion.source, ruleVersion: suggestion.ruleVersion, fingerprint: suggestion.fingerprint, locale: lang }))
      .toMatchObject({ source: suggestion.source, locale: lang })
    expect(suggestion.fingerprint).toBe(fingerprintEvidence({ ruleVersion: suggestion.ruleVersion, source: suggestion.source,
      evidence: suggestion.evidence, titleKey: suggestion.titleKey, actionKey: suggestion.actionKey, args: suggestion.args }))
    expect(JSON.stringify(scenario)).not.toMatch(/<script>|alert\(|raw_answer|access_token|verified_live/)
  })

  it('freezes both exact saved revisions with the real canonical content and hash before DTO validation', () => {
    const scenario = createJourneyScenario(lang)
    expect(scenario.canonicalDrafts.map(value => value.revision)).toEqual([1, 2])
    expect(scenario.canonicalDrafts[0]).toEqual(scenario.draft)
    expect(scenario.canonicalDrafts[1].evidenceSnapshot).toEqual(scenario.draft.evidenceSnapshot)
    expect(scenario.canonicalDrafts[1].notes).not.toBe(scenario.draft.notes)
    const hashes: string[] = []
    for (const [index, draft] of scenario.canonicalDrafts.entries()) {
      const version = scenario.canonicalVersions[index], frozen = freezeReview(draft)
      expect(version).toMatchObject({ ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation,
        id: scenario.ids.versionId, versionNumber: 1, decision: null, capabilities: { canDecide: false },
        submittedBy: { profileId: scenario.ids.ownerId, role: 'account_member' } })
      expect(version.contentHash).toBe(createHash('sha256').update(JSON.stringify(canonical(frozen.content)), 'utf8').digest('hex'))
      expect(parseVersionDetail(version, draft.id, { id: scenario.ids.versionId, contentHash: frozen.contentHash, draftRevision: draft.revision })).toEqual(version)
      expect(parseVersionPage({ versions: [version], nextCursor: null, latestVersionId: version.id }, draft.id).versions).toEqual([version])
      hashes.push(version.contentHash)
    }
    expect(new Set(hashes).size).toBe(2)
  })

  it('projects the frozen baseline honestly and leaves immediate outcome windows not due', () => {
    const scenario = createJourneyScenario(lang), version = scenario.canonicalVersions[0]
    const evidence = scenario.draft.evidenceSnapshot.evidence
    if (evidence.kind !== 'scan-check') throw new Error('Expected scan baseline')
    expect(scenario.baseline).toEqual({ source: { kind: 'scan-check', id: evidence.scanId, checkKey: evidence.checkKey },
      recordedAt: evidence.recordedAt, collectedAt: evidence.collectedAt, verdict: 'warn',
      reasons: expect.arrayContaining(['final-path-identity-withheld']) })
    expect(Date.parse(scenario.baseline.collectedAt!)).toBeLessThan(Date.parse(scenario.draft.createdAt))
    expect(Date.parse(scenario.draft.updatedAt)).toBeLessThan(Date.parse(version.submittedAt))
    expect(Date.parse(version.submittedAt)).toBeLessThan(Date.parse('2026-11-14T00:05:00.000Z'))
    expect(Date.parse('2026-11-14T00:05:00.000Z')).toBeLessThan(Date.parse(scenario.deliveredAt))
    expect(Date.parse(scenario.deliveredAt)).toBeLessThan(Date.parse(scenario.clock))
    const result = evaluateOutcomes({ clientId: scenario.ids.clientId, itemId: scenario.ids.itemId,
      versionId: version.id, contentHash: version.contentHash, evaluatedAt: scenario.clock,
      anchorState: 'active', anchor: { id: scenario.ids.attestationId, deliveredAt: scenario.deliveredAt, recordedAt: scenario.clock },
      baseline: scenario.baseline, candidates: [], sourceState: 'ok', truncated: false })
    expect(parseOutcomeResponse(result)).toEqual(result)
    expect(result.windows.map(window => window.timeState)).toEqual(['not-due', 'not-due', 'not-due'])
    expect(result.windows.every(window => window.selected === null && window.comparison.outcome === 'not_yet_observed')).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.reasons).toContain('self-reported-delivery')
  })

  it('freezes an arbitrary actual saved edit rather than substituting a finite packet', () => {
    const scenario = createJourneyScenario(lang), draft = structuredClone(scenario.draft)
    draft.revision = 3; draft.title += ' · Café'; draft.notes += '\nConfirm the owner’s final wording.'
    const original = structuredClone(draft), version = freezeJourneyDraft(draft, 2), frozen = freezeReview(draft)
    expect(version).toMatchObject({ ...frozen.content, versionNumber: 2, contentHash: frozen.contentHash,
      capabilities: { canDecide: false }, decision: null })
    expect(version.id).not.toBe(scenario.ids.versionId)
    expect(freezeJourneyDraft(draft, 2)).toEqual(version)
    expect(version.contentHash).not.toBe(scenario.canonicalVersions[0].contentHash)
    expect(version.contentHash).not.toBe(scenario.canonicalVersions[1].contentHash)
    expect(draft).toEqual(original)
    expect(freezeJourneyDraft(draft, 3).contentHash).toBe(version.contentHash)
    expect(freezeJourneyDraft(draft, 3).id).not.toBe(version.id)
    expect(() => freezeJourneyDraft({ ...draft, title: ' Non-canonical whitespace ' })).toThrow('REVIEW_VALIDATION_FAILED')
  })

  it('serializes only portable packet data and gives each reset independent state', () => {
    const first = createJourneyScenario(lang), second = createJourneyScenario(lang)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(second).toEqual(first)
    expect(new Set(Object.values(first.ids)).size).toBe(Object.values(first.ids).length)
    for (const id of Object.values(first.ids)) expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/)
    first.draft.notes = 'Local edit'
    first.canonicalDrafts[0].evidenceSnapshot.limitations.push('Local mutation')
    expect(second).toEqual(createJourneyScenario(lang))
    const frozen = first.canonicalVersions[0]
    if (frozen.schemaVersion !== 1) throw new Error('Expected V1 sample')
    expect(frozen.evidenceSnapshot.limitations).not.toContain('Local mutation')
  })
})

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses an invalid sample version number: %s', number => {
  expect(() => freezeJourneyDraft(createJourneyScenario('en').draft, number)).toThrow('Invalid sample version number')
})

it('keeps the packet contract type-only at the browser boundary, without importing the Node factory or crypto', () => {
  const contract = readFileSync(resolve('__tests__/sme-journey/types.ts'), 'utf8')
  const emitted = transpileModule(contract, { compilerOptions: {
    module: ModuleKind.ESNext, target: ScriptTarget.ES2022, verbatimModuleSyntax: true,
  } }).outputText.trim()
  expect(emitted).toBe('export {};')
  expect(emitted).not.toMatch(/scenario\.node|node:crypto|freezeReview|server-only/)
})
