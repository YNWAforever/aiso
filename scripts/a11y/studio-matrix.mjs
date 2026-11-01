import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const receiptUrl = new URL('../../docs/ux/studio-a11y/checks.json', import.meta.url)
const schema = JSON.parse(readFileSync(new URL('../../docs/ux/studio-a11y/checks.schema.json', import.meta.url), 'utf8'))
const dimensions = ['locale', 'width', 'theme', 'view']
const cellSchema = schema.properties.cells.items
const metrics = Object.keys(cellSchema.properties).filter(key => !dimensions.includes(key))

// Only the JSON Schema keywords used by checks.schema.json are needed. This
// keeps the focused receipt check independent of transitive npm dependencies.
function validateShape(value, rule, path = 'receipt') {
  if ('const' in rule) assert.equal(value, rule.const, `${path}: wrong constant`)
  if (rule.enum) assert.ok(rule.enum.includes(value), `${path}: outside allowed values`)
  if (rule.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${path}: expected object`)
    for (const key of rule.required) assert.ok(Object.hasOwn(value, key), `${path}.${key}: missing`)
    for (const key of Object.keys(value)) {
      assert.ok(Object.hasOwn(rule.properties, key), `${path}: unexpected property`)
      validateShape(value[key], rule.properties[key], `${path}.${key}`)
    }
  }
  if (rule.type === 'array') {
    assert.ok(Array.isArray(value), `${path}: expected array`)
    assert.ok(value.length >= rule.minItems && value.length <= rule.maxItems, `${path}: wrong cell count`)
    value.forEach((item, index) => validateShape(item, rule.items, `${path}[${index}]`))
  }
  if (rule.type === 'string') {
    assert.equal(typeof value, 'string', `${path}: expected string`)
    assert.match(value, new RegExp(rule.pattern), `${path}: wrong format`)
  }
  if (rule.type === 'integer') {
    assert.ok(Number.isInteger(value) && value >= rule.minimum, `${path}: expected nonnegative integer`)
  }
}

export function validateReceipt(receipt) {
  validateShape(receipt, schema)
  const keys = receipt.cells.map(cell => dimensions.map(key => cell[key]).join('/'))
  assert.equal(new Set(keys).size, 72, 'receipt: duplicate or missing matrix cell')
  // Allowed dimensions contain exactly 72 combinations, so shape + uniqueness
  // proves Cartesian completeness. A missing measurement never means zero.
  for (const cell of receipt.cells) {
    for (const metric of metrics) assert.equal(cell[metric], 0, `${dimensions.map(key => cell[key]).join('/')}: ${metric} must be zero`)
  }
  return receipt
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function receiptFromReport(reportBytes, cssBytes, productRevision) {
  const report = JSON.parse(reportBytes.toString())
  assert.equal(report.errors?.length ?? 0, 0, 'Playwright report contains errors')
  for (const key of ['unexpected', 'skipped', 'flaky']) assert.equal(report.stats?.[key], 0, `Playwright report: ${key}`)
  const cells = []
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      const title = /^Studio screens (en|zh-HK) (1440|900|390) (light|dark): reflow and axe$/.exec(spec.title)
      if (!title) continue
      for (const test of spec.tests ?? []) {
        if (test.projectName !== 'chromium') continue
        assert.equal(test.status, 'expected', 'Matrix test must pass without retries')
        assert.equal(test.results?.length, 1, 'Matrix test must have exactly one result')
        const result = test.results[0]
        assert.equal(result.status, 'passed', 'Matrix result must pass')
        const attachments = result.attachments?.filter(item => item.name === 'studio-a11y-cell') ?? []
        assert.equal(attachments.length, 6, 'Matrix test must attach all six views')
        for (const attachment of attachments) {
          assert.equal(attachment.contentType, 'application/json')
          assert.equal(typeof attachment.body, 'string', 'Inline numeric receipt is required')
          const cell = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'))
          assert.equal(cell.locale, title[1])
          assert.equal(cell.width, Number(title[2]))
          assert.equal(cell.theme, title[3])
          cells.push(cell)
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  visit(report)
  // Stable dimension order keeps receipt-only refreshes reviewable.
  cells.sort((a, b) => {
    for (const key of dimensions) {
      const values = cellSchema.properties[key].enum
      const difference = values.indexOf(a[key]) - values.indexOf(b[key])
      if (difference) return difference
    }
    return 0
  })
  return validateReceipt({
    schemaVersion: 1,
    evidenceMode: 'offline-component-fixture',
    productRevision,
    productionCssSha256: sha256(cssBytes),
    reportSha256: sha256(reportBytes),
    project: 'chromium',
    viewportHeight: 1000,
    hostedNeonAuth: 'N/A-not-run',
    cells,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      check: { type: 'boolean' }, report: { type: 'string' }, css: { type: 'string' },
      revision: { type: 'string' }, output: { type: 'string' },
    } })
    if (values.check) {
      assert.equal(Object.keys(values).length, 1, '--check takes no other options')
      validateReceipt(JSON.parse(readFileSync(receiptUrl, 'utf8')))
    } else {
      assert.ok(values.report && values.css && values.revision && values.output,
        'Use --check, or --report <Playwright JSON> --css <build.css> --revision <product SHA> --output <checks.json>')
      const receipt = receiptFromReport(readFileSync(values.report), readFileSync(values.css), values.revision)
      writeFileSync(values.output, JSON.stringify(receipt, null, 2) + '\n')
    }
    process.stdout.write('Studio matrix: 72/72 offline cells pass; hosted Neon/Auth N/A.\n')
  } catch (error) {
    process.stderr.write(`Studio matrix check failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
