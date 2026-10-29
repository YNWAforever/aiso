import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('holds the product to one name, Fimmick AISO', () => {
    const result = audit({
      ...catalogue(
        { old: 'Welcome to Fimmick AEO', bare: 'AISO will try again tomorrow', score: 'Your AISO score', full: 'Fimmick AISO will try again' },
        { old: '歡迎使用 Fimmick AEO', bare: 'AISO 會於明天再試', score: 'AISO 總分', full: 'Fimmick AISO 會再試' },
      ),
      'lib/mail.ts': ["export const title = 'FimmickAEO'", "export const from = 'alerts@fimmick-aeo.com'", "export const host = 'fimmick-aeo-oitb.vercel.app'"].join('\n'),
    })
    expect(result.status).toBe(1)
    for (const where of ['en old', 'zh-HK old', 'en bare', 'zh-HK bare', 'lib/mail.ts:1']) expect(result.stdout).toContain(`naming        ${where} `)
    for (const where of ['en score', 'en full', 'zh-HK score', 'lib/mail.ts:2', 'lib/mail.ts:3']) expect(result.stdout).not.toContain(`naming        ${where} `)
  })

  it('permits only the exact approved Studio source-bar shorthand', () => {
    const allowlist = readFileSync('scripts/text-audit-allowlist.json', 'utf8')
    const result = audit({
      ...catalogue(
        { conversationStudio: { savedDataLabel: 'Data saved in AISO' }, other: 'Data saved in AISO' },
        { conversationStudio: { savedDataLabel: 'AISO 已保存資料' }, other: 'AISO 已保存資料' },
      ),
      'scripts/text-audit-allowlist.json': allowlist,
    })
    expect(result.stdout).not.toContain('naming        en conversationStudio.savedDataLabel ')
    expect(result.stdout).not.toContain('naming        zh-HK conversationStudio.savedDataLabel ')
    expect(result.stdout).toContain('naming        en other ')
    expect(result.stdout).toContain('naming        zh-HK other ')
    const changed = audit({
      ...catalogue({ conversationStudio: { savedDataLabel: 'AISO will do everything' } }, { conversationStudio: { savedDataLabel: 'AISO 會完成所有工作' } }),
      'scripts/text-audit-allowlist.json': allowlist,
    })
    expect(changed.stdout).toContain('naming        en conversationStudio.savedDataLabel ')
    expect(changed.stdout).toContain('naming        zh-HK conversationStudio.savedDataLabel ')
  })

  it('permits only the exact Stage 3 answer label at its approved key', () => {
    const allowlist = readFileSync('scripts/text-audit-allowlist.json', 'utf8')
    const result = audit({
      ...catalogue(
        { conversationStudio: { answerLabel: 'AISO · Answer' }, other: 'AISO · Answer' },
        { conversationStudio: { answerLabel: 'AISO · 回答' }, other: 'AISO · 回答' },
      ),
      'scripts/text-audit-allowlist.json': allowlist,
    })
    expect(result.stdout).not.toContain('naming        en conversationStudio.answerLabel ')
    expect(result.stdout).not.toContain('naming        zh-HK conversationStudio.answerLabel ')
    expect(result.stdout).toContain('naming        en other ')
    expect(result.stdout).toContain('naming        zh-HK other ')
    const changed = audit({
      ...catalogue({ conversationStudio: { answerLabel: 'AISO will answer everything' } }, { conversationStudio: { answerLabel: 'AISO 會回答所有問題' } }),
      'scripts/text-audit-allowlist.json': allowlist,
    })
    expect(changed.stdout).toContain('naming        en conversationStudio.answerLabel ')
    expect(changed.stdout).toContain('naming        zh-HK conversationStudio.answerLabel ')
  })
})
