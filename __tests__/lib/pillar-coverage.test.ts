import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { calculatePillarScores, isPillarScoreSnapshot, resolvePillarScores, pillarStateForCoverage, PILLAR_WEIGHTS } from '@/lib/pillar-scores'
import { buildScanEvidence, readScanEvidence, pillarInputsFromEvidence } from '@/lib/scan-evidence'

const results = Object.fromEntries([...new Set(Object.values(PILLAR_WEIGHTS).flatMap(Object.keys))].map(key => [key, { status: 'pass', message: 'ok' }]))
const checks = Object.fromEntries(Object.keys(results).map(key => [key, { applicability: 'applicable', collection: 'complete', assessment: 'pass' }]))

describe('C7 evidence-gated pillar contract', () => {
  it.each([[0,'insufficient_evidence'],[.669999,'insufficient_evidence'],[.67,'provisional'],[.849999,'provisional'],[.85,'scored'],[1,'scored']] as const)('gates unrounded coverage %s', (coverage, state) => {
    expect(pillarStateForCoverage(coverage)).toBe(state)
  })
  it('withholds numeric diagnostics when historical checks have no evidence', () => {
    const scores = calculatePillarScores(results)
    expect(scores.seo).toMatchObject({ score: null, coverage: 0, state: 'insufficient_evidence' })
  })
  it('uses complete evidence and excludes explicit not-applicable weights', () => {
    const evidence = buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:'general_b2c',region:'global',sitemapSource:'fetched',checks: {...checks, c1_robots:{assessment:'not-applicable',collection:'unsupported'}}})
    const scores = calculatePillarScores(results, evidence.checks)
    expect(scores.seo).toMatchObject({ score: 100, maximum: 38, coverage: 1, covered: 10, state: 'scored' })
  })
  it.each(['partial','failed','blocked','unsupported','unknown'])('does not count %s collection as observed even with passing status', collection => {
    const scores = calculatePillarScores(results, {...checks,c17_citation_density:{...checks.c17_citation_density,collection},c15_entity:{...checks.c15_entity,collection}})
    expect(scores.geo).toMatchObject({score:null,state:'insufficient_evidence',covered:4})
    expect(scores.geo.coverage).toBe(20/30)
  })
  it('does not grant observed coverage to missing results or unverifiable assessments', () => {
    const scores = calculatePillarScores({}, checks)
    expect(scores.geo.score).toBeNull()
    const unknown = calculatePillarScores(results, Object.fromEntries(Object.keys(checks).map(key => [key,{...checks[key],assessment:'not-verifiable'}])))
    expect(unknown.seo.coverage).toBe(0)
  })
  it('all not-applicable leaves zero applicable weight and no numeric score', () => {
    const scores = calculatePillarScores(results, Object.fromEntries(Object.keys(checks).map(key => [key,{applicability:'not-applicable',assessment:'not-applicable',collection:'unsupported'}])))
    expect(scores.geo).toMatchObject({score:null,maximum:0,coverage:0,state:'insufficient_evidence'})
  })
  it('preserves original numeric historical snapshots without adding new state', () => {
    const pillar = {score:100,earned:12,maximum:50,coverage:.24,checks:11,covered:1,passing:1,warnings:0,failing:0}
    const legacy = {methodologyVersion:'2026-08-26.v1',seo:pillar,aeo:pillar,geo:pillar}
    expect(resolvePillarScores({pillarScores:legacy})).toBe(legacy)
  })
  it('still reads C6 evidence under its original pillar method after the version bump', () => {
    const evidence = buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:'general_b2c',region:'global',sitemapSource:'fetched',checks:{}})
    evidence.pillarMethod = '2026-08-26.v1'
    evidence.comparison.pillarMethod = '2026-08-26.v1'
    evidence.comparisonSignature = createHash('sha256').update(JSON.stringify(evidence.comparison)).digest('hex')
    expect(readScanEvidence(evidence)).toEqual(evidence)
  })
})

it('rejects current snapshots that contradict coverage or omit the new state', () => {
  const snapshot = calculatePillarScores(results, checks)
  expect(isPillarScoreSnapshot({...snapshot, seo:{...snapshot.seo,coverage:.2}})).toBe(false)
  expect(isPillarScoreSnapshot({...snapshot, seo:{...snapshot.seo,state:undefined}})).toBe(false)
})

it('only exposes normalized pillar inputs after validating the full evidence envelope', () => {
  const evidence = buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:'general_b2c',region:'global',sitemapSource:'fetched',checks})
  const inputs = pillarInputsFromEvidence(evidence)
  expect(inputs.c1_robots).toEqual({applicability:'applicable',collection:'complete',assessment:'pass'})
  expect(pillarInputsFromEvidence({...evidence,pillarMethod:'unregistered'})).toEqual({})
  expect(pillarInputsFromEvidence({...evidence,comparisonSignature:'invalid'})).toEqual({})
  expect(pillarInputsFromEvidence(undefined)).toEqual({})
})
