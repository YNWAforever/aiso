import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('typechecks real app source without walking generated evidence copies', () => {
  const root = process.cwd()
  mkdirSync(join(root, 'artifacts'), { recursive: true })
  const directory = mkdtempSync(join(root, 'artifacts', 'tsconfig-probe-'))
  const generated = join(directory, 'worker-copy.ts')
  writeFileSync(generated, 'export const fixtureOnly = true\n', 'utf8')
  try {
    const config = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
    const resolved = ts.parseJsonConfigFileContent(config, ts.sys, root)
    const paths = resolved.fileNames.map(path => path.replaceAll('\\', '/'))
    const normalizedRoot = root.replaceAll('\\', '/')
    expect(paths).not.toContain(generated.replaceAll('\\', '/'))
    expect(paths).toContain(normalizedRoot + '/lib/db.ts')
    expect(paths).toContain(normalizedRoot + '/app/api/scan/route.ts')
    expect(paths).toContain(normalizedRoot + '/__tests__/ci/disposable-role-authorization.test.ts')
  } finally {
    unlinkSync(generated)
    rmdirSync(directory)
  }
})
