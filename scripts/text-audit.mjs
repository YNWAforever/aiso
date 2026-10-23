#!/usr/bin/env node
/**
 * Text audit: every user-facing string lives in messages/, in both languages.
 *
 *   hardcoded     JSX text, or a user-facing JSX attribute (aria-label, alt,
 *                 placeholder, title, label), written as a literal in app/ or
 *                 components/ instead of coming from the catalogue; also
 *                 copy kept beside the code per language (an object keyed
 *                 'en' / 'zh-HK', a COPY_EN-style constant, or a
 *                 lang === 'zh-HK' ? '…' : '…' choice between two strings)
 *   parity        a key present in one catalogue only, or an ICU argument
 *                 ({name}, {count, plural, ...}) that differs between them
 *   untranslated  a zh-HK value identical to its en value while it still
 *                 reads as English prose
 *   claims        wording the product must not use (it cannot observe that a
 *                 page was cited, ranked or guaranteed anything)
 *
 * Each of those fails the run. Product-name spellings are counted and
 * reported only: which name to standardise on is still open.
 *
 * Admin and developer surfaces are internal and English-only by decision, so
 * app/admin, components/admin and components/dev are not scanned. Accepted
 * exceptions live in scripts/text-audit-allowlist.json with a reason each.
 *
 * Usage: node scripts/text-audit.mjs [--json report.json]
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SCAN = ['app', 'components']
const LOCALE_KEYS = new Set(['en', 'zh-HK', 'zhHK', 'zh'])
const LOCALE_CONST = /^(copy|text|labels?|strings?|messages?)_?(en|zh|zh_?hk)$/i
const SKIP = ['app/admin', 'components/admin', 'components/dev']
const ATTRIBUTES = new Set(['aria-label', 'alt', 'placeholder', 'title', 'label', 'aria-description'])
const allowlist = JSON.parse(readFileSync(join(ROOT, 'scripts/text-audit-allowlist.json'), 'utf8'))

/** Text a reader would read: two or more letters in a row, Latin or Han. */
const WORDY = /[A-Za-z]{2,}|[㐀-鿿]/

function files(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const rel = relative(ROOT, path).split(sep).join('/')
    if (SKIP.some(skip => rel === skip || rel.startsWith(`${skip}/`)) || allowlist.skipFiles.some(entry => entry.file === rel)) continue
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (path.endsWith('.tsx')) out.push(rel)
  }
  return out
}

function hardcoded() {
  const findings = []
  for (const file of SCAN.filter(dir => existsSync(join(ROOT, dir))).flatMap(dir => files(join(ROOT, dir)))) {
    const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const report = (node, text) => {
      const value = text.replace(/\s+/g, ' ').trim()
      if (!WORDY.test(value) || /^(en|zh|zh-HK|zh-Hant-HK|en-[A-Z]{2})$/.test(value) || allowlist.hardcoded.some(entry => entry.text === value && (!entry.file || entry.file === file))) return
      const { line } = source.getLineAndCharacterOfPosition(node.getStart())
      findings.push({ file, line: line + 1, text: value })
    }
    const literal = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    const wordyLiterals = node => {
      const found = []
      const walk = child => {
        // Keys and CSS classes are code, not copy.
        if (ts.isPropertyAssignment(child)) { walk(child.initializer); return }
        if (ts.isJsxAttribute(child) && child.name.getText() === 'className') return
        if (literal(child) && WORDY.test(child.text)) found.push(child)
        ts.forEachChild(child, walk)
      }
      walk(node)
      return found
    }
    const visit = node => {
      if (ts.isJsxText(node)) report(node, node.getText())
      // { en: {...}, 'zh-HK': {...} } and const COPY_EN = {...}
      if (ts.isObjectLiteralExpression(node)) {
        const keys = node.properties.map(prop => prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null)
        if (keys.filter(key => LOCALE_KEYS.has(key)).length >= 2) for (const found of wordyLiterals(node)) report(found, found.text)
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && LOCALE_CONST.test(node.name.text) && node.initializer) {
        for (const found of wordyLiterals(node.initializer)) report(found, found.text)
      }
      // lang === 'zh-HK' ? '…' : '…'
      if (ts.isConditionalExpression(node) && /['"](zh-HK|en)['"]/.test(node.condition.getText())
        && literal(node.whenTrue) && literal(node.whenFalse)) {
        for (const branch of [node.whenTrue, node.whenFalse]) if (WORDY.test(branch.text)) report(branch, branch.text)
      }
      if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText()) && node.initializer) {
        const init = node.initializer
        if (ts.isStringLiteral(init)) report(init, init.text)
        else if (ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) report(init, init.expression.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return findings
}

function flatten(value, prefix = '', out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, out)
    else out[path] = Array.isArray(child) ? child.join('\n') : String(child)
  }
  return out
}

/**
 * Top-level ICU argument names. Types may differ: English needs
 * {count, plural, ...} where Chinese takes a plain {count}.
 */
function icuArguments(message) {
  const args = new Set()
  let depth = 0
  for (let i = 0; i < message.length; i += 1) {
    const char = message[i]
    if (char === "'" && message[i + 1] === "'") { i += 1; continue }
    if (char === '{') {
      if (depth === 0) {
        const match = /^\{\s*([A-Za-z_][\w]*)/.exec(message.slice(i))
        if (match) args.add(match[1])
      }
      depth += 1
    } else if (char === '}') depth = Math.max(0, depth - 1)
  }
  return [...args].sort().join(',')
}

const en = flatten(JSON.parse(readFileSync(join(ROOT, 'messages/en.json'), 'utf8')))
const zh = flatten(JSON.parse(readFileSync(join(ROOT, 'messages/zh-HK.json'), 'utf8')))

function parity() {
  const findings = []
  for (const key of Object.keys(en)) if (!(key in zh)) findings.push({ key, problem: 'missing in zh-HK' })
  for (const key of Object.keys(zh)) if (!(key in en)) findings.push({ key, problem: 'missing in en' })
  for (const key of Object.keys(en)) {
    if (!(key in zh)) continue
    const [a, b] = [icuArguments(en[key]), icuArguments(zh[key])]
    if (a !== b) findings.push({ key, problem: `arguments differ: en {${a}} zh-HK {${b}}` })
  }
  return findings
}

/** Identical in both catalogues and still English prose: three or more Latin words. */
function untranslated() {
  const accepted = new Set(allowlist.untranslated.map(entry => entry.key))
  return Object.keys(en)
    .filter(key => zh[key] === en[key] && !accepted.has(key))
    .filter(key => (en[key].replace(/\{[^}]*\}/g, ' ').match(/[A-Za-z]{2,}/g) ?? []).length >= 3)
    .map(key => ({ key, text: en[key] }))
}

function claims() {
  const findings = []
  const accepted = new Set(allowlist.claims.map(entry => `${entry.locale}:${entry.key}`))
  for (const rule of allowlist.claimRules) {
    const pattern = new RegExp(rule.pattern, 'iu')
    for (const [locale, catalogue] of [['en', en], ['zh-HK', zh]]) {
      for (const [key, text] of Object.entries(catalogue)) {
        if (pattern.test(text) && !accepted.has(`${locale}:${key}`)) findings.push({ locale, key, rule: rule.id, text })
      }
    }
  }
  return findings
}

function productNames() {
  const counts = {}
  for (const text of [...Object.values(en), ...Object.values(zh)]) {
    for (const name of ['Fimmick AISO', 'Fimmick AEO', 'Fimmick', 'AISO', 'AEO']) {
      const matches = text.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0
      if (matches) counts[name] = (counts[name] ?? 0) + matches
    }
  }
  return counts
}

const report = { hardcoded: hardcoded(), parity: parity(), untranslated: untranslated(), claims: claims(), productNames: productNames() }
const failures = report.hardcoded.length + report.parity.length + report.untranslated.length + report.claims.length

const jsonAt = process.argv.indexOf('--json')
if (jsonAt > 0 && process.argv[jsonAt + 1]) writeFileSync(process.argv[jsonAt + 1], `${JSON.stringify(report, null, 2)}\n`)

for (const finding of report.hardcoded) console.log(`hardcoded     ${finding.file}:${finding.line}  ${JSON.stringify(finding.text)}`)
for (const finding of report.parity) console.log(`parity        ${finding.key}  ${finding.problem}`)
for (const finding of report.untranslated) console.log(`untranslated  ${finding.key}  ${JSON.stringify(finding.text)}`)
for (const finding of report.claims) console.log(`claims        ${finding.locale} ${finding.key}  [${finding.rule}] ${JSON.stringify(finding.text)}`)
console.log(`product names (reported, not enforced): ${JSON.stringify(report.productNames)}`)
console.log(failures ? `\ntext audit: ${failures} finding(s)` : '\ntext audit: clean')
process.exitCode = failures ? 1 : 0
