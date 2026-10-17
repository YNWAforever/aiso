import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

// Only the runner loads these pure application builders. No production module or
// resolver is modified, and no generated fixture module is written into the repo.
export async function fixtureResults(root, { clear = false } = {}) {
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('@/lib/')) {
        return { url: pathToFileURL(resolve(root, `${specifier.slice(2)}.ts`)).href, shortCircuit: true }
      }
      return next(specifier, context)
    },
    load(url, context, next) {
      if (url.startsWith(pathToFileURL(resolve(root, 'lib')).href) && url.endsWith('.ts')) {
        return {
          format: 'module', shortCircuit: true,
          source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          }).outputText,
        }
      }
      return next(url, context)
    },
  })
  try {
    const evidence = await import(pathToFileURL(resolve(root, 'lib/scan-evidence.ts')).href)
    const scoring = await import(pathToFileURL(resolve(root, 'lib/scoring.ts')).href)
    const collectedAt = '2026-10-17T00:00:00.000Z'
    const checks = Object.fromEntries(Object.keys(evidence.CHECK_VERSIONS).map(key => [key, {
      assessment: !clear && (key === 'c1_robots' || key === 'c2_llms_txt') ? 'fail' : 'pass',
      collection: 'complete',
    }]))
    const results = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, {
      status: value.assessment, message: 'SYNTHETIC local browser fixture; no external collection performed.',
    }]))
    results.evidence = evidence.buildScanEvidence({
      requestedUrl: 'https://fixture-aiso.example', evaluatedUrl: 'https://fixture-aiso.example',
      industry: 'technology', region: 'HK', sitemapSource: 'caller', checks, collectedAt,
      observations: [{ check: 'page', collection: 'complete', httpStatus: 200, observedAt: collectedAt,
        target: { origin: 'https://fixture-aiso.example' }, signals: { mimeType: 'text/html' } }],
    })
    results.localFixture = { kind: 'SYNTHETIC_SCAN_NO_COLLECTION_OR_PROVIDER', collectedExternally: false }
    const score = scoring.calculateScore(results) + scoring.calculateGeoScore(results)
    return { results, score, grade: scoring.assignGrade(score), collectedAt }
  } finally { hook.deregister() }
}
