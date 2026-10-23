import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts/text-audit.mjs')
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function audit(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'text-audit-'))
  dirs.push(root)
  const all: Record<string, string> = {
    'scripts/text-audit-allowlist.json': JSON.stringify({ hardcoded: [], untranslated: [], claims: [], skipFiles: [], claimRules: [{ id: 'guarantee', pattern: '(?<!\\b(?:not|no)\\s(?:\\w+\\s){0,2})\\bguarantee(?:d|s)?\\b' }] }),
    'app/.keep': '',
    ...files,
  }
  for (const [path, body] of Object.entries(all)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  // The script resolves typescript from the repository it lives in.
  return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') } })
}

const catalogue = (en: object, zh: object) => ({ 'messages/en.json': JSON.stringify(en), 'messages/zh-HK.json': JSON.stringify(zh) })

describe('text audit', () => {
  it('passes the repository as committed', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(result.stdout).toContain('text audit: clean')
    expect(result.status).toBe(0)
  })

  it('fails on JSX text, per-language copy objects and locale ternaries', () => {
    const result = audit({
      ...catalogue({ a: { b: 'Hello' } }, { a: { b: '你好' } }),
      'components/Card.tsx': [
        "const COPY_EN = { title: 'Saved reports' }",
        "export function Card({ lang }: { lang: string }) {",
        "  const label = lang === 'zh-HK' ? '關閉' : 'Close'",
        "  return <p aria-label=\"Report card\">Your latest report{label}</p>",
        '}',
      ].join('\n'),
    })
    expect(result.status).toBe(1)
    for (const text of ['Saved reports', '關閉', 'Close', 'Report card', 'Your latest report']) expect(result.stdout).toContain(JSON.stringify(text))
  })

  it('ignores class names, locale codes and object keys', () => {
    const result = audit({
      ...catalogue({ a: 'Hi' }, { a: '嗨' }),
      'components/Ok.tsx': "export const Ok = ({ lang }: { lang: string }) => <div className=\"flex items-center\" lang={lang === 'zh-HK' ? 'zh-HK' : 'en'} />",
    })
    expect(result.stdout).toContain('text audit: clean')
  })

  it('fails on missing keys, differing arguments and untranslated prose, not on plural shape', () => {
    const result = audit(catalogue(
      { only: 'x', args: 'Hi {name}', plural: '{count, plural, one {# item} other {# items}}', prose: 'Review the latest scan results' },
      { args: '你好 {who}', plural: '{count} 項', prose: 'Review the latest scan results' },
    ))
    expect(result.stdout).toContain('only  missing in zh-HK')
    expect(result.stdout).toContain('args  arguments differ')
    expect(result.stdout).not.toContain('plural  arguments differ')
    expect(result.stdout).toContain('untranslated  prose')
  })

  it('flags a promise but not its negation', () => {
    const result = audit(catalogue({ yes: 'We guarantee results', no: 'This does not guarantee traffic' }, { yes: '保證', no: '不保證' }))
    expect(result.stdout).toContain('[guarantee] "We guarantee results"')
    expect(result.stdout).not.toContain('does not guarantee')
  })
})
