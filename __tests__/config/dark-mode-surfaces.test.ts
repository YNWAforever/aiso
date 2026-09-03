import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Public pages must paint surfaces with tokens, never hardcoded white or black.
 *
 * `--background` is #050510 in dark mode, so a hardcoded surface white renders
 * a white card on a near-black page. The a11y gate cannot catch this: white
 * surfaces carry dark text, contrast passes, and the page is simply not dark.
 *
 * SCOPE IS DELIBERATELY NARROW, and widening it will break the guard:
 *
 *   - `text-white` is ALLOWED. There are 17 in app/, nearly all white text on
 *     saturated brand backgrounds, which is correct in both themes. Banning it
 *     fails on 17 non-defects.
 *   - The `print:` variant is ALLOWED. app/[lang]/r/[slug]/page.tsx uses it on
 *     purpose -- printing a dark page wastes ink.
 *
 * A guard that cries wolf gets deleted, and then the real defect returns with
 * nothing watching for it.
 */
const ROOT = join('app', '[lang]')

// Surface utilities only: backgrounds and gradient stops. Not text.
const FORBIDDEN = /\b(bg|from|via|to)-(white|black)\b/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx')) out.push(full)
    }
  }
  walk(dir)
  return out
}

describe('public pages paint surfaces with tokens', () => {
  it('no hardcoded white or black surface under app/[lang]/', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(process.cwd(), ROOT))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Strip print: variants before testing, so they are exempt wherever
        // they appear rather than only when adjacent to something else.
        if (FORBIDDEN.test(line.replace(/print:[a-z-]+(\/\d+)?/g, ''))) {
          const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/')
          offenders.push(`${rel}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
