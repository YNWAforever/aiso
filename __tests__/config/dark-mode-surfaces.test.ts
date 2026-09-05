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
 *   - Light-tint surfaces/borders are banned only through the 50-100-200
 *     range. Darker tints like `bg-slate-950` are legitimate -- app/[lang]/
 *     page.tsx uses one deliberately as an always-dark section, correct in
 *     both themes -- so banning them would produce false positives, and a
 *     guard that cries wolf gets deleted.
 *
 * A guard that cries wolf gets deleted, and then the real defect returns with
 * nothing watching for it.
 */
const ROOT = join('app', '[lang]')

// Surface utilities only: backgrounds, gradient stops, and borders. Not text.
// The 50/100/200 tints read as light-mode "cards" or "hairlines" even when
// hand-picked, so they're the ones that survive as hardcoded light surfaces
// once everything else has been tokenised. Darker tints (bg-slate-950, etc.)
// are excluded on purpose -- see the note above.
const FORBIDDEN = /\b(bg|from|via|to)-(white|black)\b|\b(bg|from|via|to|border)-(slate|gray|zinc|neutral|stone)-(50|100|200)\b/

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
