import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Messages = Record<string, unknown>

function readMessages(locale: 'en' | 'zh-HK') {
  return JSON.parse(
    readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'),
  ) as Messages
}

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Messages).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('report message parity', () => {
  it.each(['reports', 'reportBranding'] as const)(
    'keeps the %s namespace identical in English and Hong Kong Traditional Chinese',
    namespace => {
      const en = readMessages('en')
      const zh = readMessages('zh-HK')

      expect(en).toHaveProperty(namespace)
      expect(zh).toHaveProperty(namespace)
      expect(flattenKeys(zh[namespace]).sort()).toEqual(flattenKeys(en[namespace]).sort())
    },
  )
})
