/**
 * Lighthouse CI for the public pages, run by the `build` job of
 * .github/workflows/pr-gate.yml against the production build in fixture mode
 * (E2E_FIXTURE_MODE serves the result page from lib/e2e-fixtures.ts).
 *
 * Blocking: accessibility 100, layout shift ≤ 0.1, and a JavaScript budget per
 * page (transfer size, set from main with room for one feature). Warning only:
 * the performance score and LCP, which move ±5 points between CI runners.
 * Three runs per URL; assertions use the median run.
 */
const ASSESSED_SCAN = 'e2e00000-0000-4000-a000-000000000100'
const BASE = process.env.LHCI_BASE_URL || 'http://127.0.0.1:3000'

const PAGES = [
  { path: '/en', scriptKb: 200 },
  { path: '/zh-HK', scriptKb: 200 },
  { path: '/en/pricing', scriptKb: 200 },
  { path: '/en/scan', scriptKb: 220 },
  { path: '/en/sample-report', scriptKb: 200 },
  { path: '/zh-HK/sample-report', scriptKb: 200 },
  { path: `/en/result/${ASSESSED_SCAN}`, scriptKb: 380 },
]

const escape = path => path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

module.exports = {
  ci: {
    collect: {
      url: PAGES.map(page => `${BASE}${page.path}`),
      numberOfRuns: 3,
      ...(process.env.LHCI_BASE_URL ? {} : {
        startServerCommand: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 -p 3000',
        startServerReadyPattern: 'Ready',
        startServerReadyTimeout: 60000,
      }),
      settings: { chromeFlags: '--no-sandbox --headless=new', onlyCategories: ['performance', 'accessibility'] },
    },
    assert: {
      assertMatrix: PAGES.map(page => ({
        matchingUrlPattern: `${escape(page.path)}$`,
        aggregationMethod: 'median-run',
        assertions: {
          'categories:accessibility': ['error', { minScore: 1 }],
          'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
          'resource-summary:script:size': ['error', { maxNumericValue: page.scriptKb * 1024 }],
          'categories:performance': ['warn', { minScore: 0.85 }],
          'largest-contentful-paint': ['warn', { maxNumericValue: 4000 }],
          'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        },
      })),
    },
    upload: { target: 'filesystem', outputDir: 'artifacts/build/lighthouse' },
  },
}
