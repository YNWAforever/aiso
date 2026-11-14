import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Build first, then: node scripts/sme-preview.mjs --output artifacts/sme-preview
// This local generator executes only the focused offline renderer. It starts no server.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = { output: resolve(root, 'artifacts/sme-preview'), css: '' }
const args = process.argv.slice(2)
if (args.includes('--help')) {
  process.stdout.write('Usage: node scripts/sme-preview.mjs [--output DIRECTORY] [--css BUILD_CSS]\nRun npm run build first. Open en-preview.html or zh-HK-preview.html locally; no server or credentials are needed.\n')
} else {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use the repository-required Node 24 runtime')
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index], value = args[index + 1]
      if (!['--output', '--css'].includes(key) || !value) throw new Error('Expected --output DIRECTORY or --css BUILD_CSS')
      if (key === '--output') options.output = resolve(root, value)
      else options.css = resolve(root, value)
    }
    mkdirSync(options.output, { recursive: true })
    // Re-read the current build on every default invocation; an older fixture cache is not final CSS.
    let cssPath = options.css
    if (!cssPath) {
      const chunks = join(root, '.next/static/chunks')
      const files = existsSync(chunks) ? readdirSync(chunks).filter(file => file.endsWith('.css')).sort() : []
      if (!files.length) throw new Error('Actual production build CSS is required; run npm run build first or pass --css BUILD_CSS')
      cssPath = join(options.output, 'build.css')
      writeFileSync(cssPath, files.map(file => readFileSync(join(chunks, file), 'utf8')).join('\n'))
    }
    if (!existsSync(cssPath) || !readFileSync(cssPath, 'utf8').trim()) throw new Error('The selected build CSS is missing or empty')
    const environment = { ...process.env }
    // Avoid activating other optional fixture writers inherited from a developer shell.
    for (const key of Object.keys(environment)) if (key.endsWith('_HTML_DIR')) delete environment[key]
    environment.C9J_HTML_DIR = options.output
    environment.C9J_CSS_PATH = cssPath
    const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '__tests__/components/journey-render.test.tsx', '--maxWorkers=1'], { cwd: root, env: environment, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw new Error('Controlled journey renderer failed')
    const manifestPath = join(options.output, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const sourceFiles = [
      '__tests__/sme-journey/types.ts', '__tests__/sme-journey/scenario.node.ts', '__tests__/sme-journey/transport.ts',
      '__tests__/sme-journey/JourneyFixture.tsx', '__tests__/components/journey-render.test.tsx', 'scripts/sme-preview.mjs',
      'components/dashboard/today/BrandToday.tsx', 'lib/view-models/today.ts', 'components/opportunities/OpportunityWorkspace.tsx',
      'components/work-items/DraftEditor.tsx', 'components/change-sets/VersionWorkspace.tsx', 'components/change-sets/DecisionForm.tsx',
      'components/change-sets/ReviewHelp.tsx', 'components/delivery/DeliveryWorkspace.tsx', 'components/delivery/DeliveryForm.tsx',
      'components/delivery/DeliveryHistory.tsx', 'components/outcomes/OutcomeWorkspace.tsx', 'components/outcomes/OutcomeWindows.tsx',
      'lib/change-sets/validation.ts', 'lib/opportunities/fingerprint.ts', 'messages/en.json', 'messages/zh-HK.json',
    ]
    const hash = value => createHash('sha256').update(value).digest('hex')
    const sources = Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(join(root, file)))]))
    const checkoutSha = readCheckoutSha(root)
    for (const [file, expected] of Object.entries(manifest.artifacts)) if (hash(readFileSync(join(options.output, file))) !== expected) throw new Error(`Artifact hash mismatch: ${file}`)
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, checkoutSha, lockSha256: hash(readFileSync(join(root, 'package-lock.json'))), sourceSha256: hash(JSON.stringify(sources)), sources,
      reproduction: ['npm ci', 'npm run build', 'node scripts/sme-preview.mjs --output artifacts/sme-preview'],
      verification: 'Generated artifacts passed the focused renderer and content hash readback; browser execution and human usability are separate.',
    }, null, 2) + '\n')
    process.stdout.write(`Controlled preview: ${join(options.output, 'en-preview.html')}\nChinese preview: ${join(options.output, 'zh-HK-preview.html')}\nManifest: ${manifestPath}\n`)
  } catch (error) {
    process.stderr.write(String(error instanceof Error ? error.message : error) + '\n')
    process.exitCode = 1
  }
}

function readCheckoutSha(directory) {
  const entry = join(directory, '.git')
  let gitDirectory = entry
  try {
    const pointer = readFileSync(entry, 'utf8').trim()
    if (!pointer.startsWith('gitdir: ')) throw new Error('Unsupported Git directory pointer')
    gitDirectory = resolve(directory, pointer.slice(8))
  } catch (error) {
    if (!existsSync(join(entry, 'HEAD'))) throw error
  }
  const head = readFileSync(join(gitDirectory, 'HEAD'), 'utf8').trim()
  if (/^[a-f0-9]{40}$/.test(head)) return head
  if (!head.startsWith('ref: ')) throw new Error('Cannot identify checkout revision')
  const reference = head.slice(5)
  const commonDirectory = existsSync(join(gitDirectory, 'commondir')) ? resolve(gitDirectory, readFileSync(join(gitDirectory, 'commondir'), 'utf8').trim()) : gitDirectory
  for (const directory of [gitDirectory, commonDirectory]) {
    const loose = join(directory, reference)
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    const packed = join(directory, 'packed-refs')
    if (existsSync(packed)) {
      const row = readFileSync(packed, 'utf8').split(/\r?\n/).find(line => line.endsWith(' ' + reference))
      if (row) return row.split(' ')[0]
    }
  }
  throw new Error('Cannot resolve checkout revision')
}
