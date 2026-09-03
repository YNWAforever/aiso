import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `--input` is the input FILL colour and nothing else.
 *
 * It is byte-identical to `--card` in both themes (#ffffff light, #0d0d18
 * dark), so using it as a border colour draws a border the exact colour of the
 * surface it sits on -- invisible, with no error, no lint failure and no
 * failing test. That is how ten of them survived in the public scan form and
 * the onboarding wizard. Use `border-border` for borders.
 *
 * A source-text scan is the right shape here, unlike the guards in
 * playwright-projects.test.ts and check-explanations-parity.test.ts which
 * deliberately avoid reading source. In those the text was correct and the
 * semantics were wrong, so text could not see the bug. Here the assertion IS
 * about text: "this class string does not appear". A rendering-based version
 * would be slower, flakier, and blind to any file no test renders.
 *
 * This also guards the next slice: the donor repo resolves `--input` to a LINE
 * colour and 16 of its components/ui files use it that way, so copying one in
 * would silently reintroduce this.
 */

/**
 * NOTE: this file itself contains the forbidden string, in the check below. It
 * passes only because __tests__/ is not scanned. Do NOT broaden ROOTS to
 * include __tests__ without excluding this file, or the guard fails on itself
 * and reads as a false positive.
 */
const ROOTS = ['app', 'components']

const FORBIDDEN = 'border-input'

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full)
    }
  }
  walk(dir)
  return out
}

describe('--input is the fill token only', () => {
  it('no file uses it as a border colour', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (line.includes(FORBIDDEN)) {
            const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/')
            offenders.push(`${rel}:${i + 1}`)
          }
        })
      }
    }
    expect(offenders).toEqual([])
  })
})
