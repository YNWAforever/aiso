import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The Phase 1 token set (docs/ux/visual-system.md): every new token is defined
 * in both themes, and every text-on-surface pairing the components use clears
 * WCAG AA. Read from source because the pairings are the contract; a rendered
 * check would only see whichever components happen to be on a page.
 */
const css = readFileSync('app/globals.css', 'utf8')

function block(selector: string, source = css): Record<string, string> {
  const start = source.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const body = source.slice(start, source.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6}|var\(--[\w-]+\))\s*;/gi)].map(m => [m[1]!, m[2]!.toLowerCase()]))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const themes = { light: block(':root'), dark: block('.dark') }
const TONES = ['success', 'warning', 'danger', 'info'] as const

describe('design tokens', () => {
  it('binds dark: utilities to the .dark class, not the OS preference', () => {
    expect(css).toMatch(/@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/)
  })

  it('defines every new token in both themes', () => {
    const names = [
      ...Array.from({ length: 12 }, (_, i) => `--neutral-${i + 1}`),
      ...TONES.flatMap(tone => [`--tone-${tone}`, `--tone-${tone}-soft`, `--tone-${tone}-fg`]),
    ]
    for (const [theme, tokens] of Object.entries(themes)) for (const name of names) expect(tokens[name], `${theme} ${name}`).toBeDefined()
    for (const shadow of ['--shadow-e1', '--shadow-e2', '--shadow-e3']) expect(css.match(new RegExp(`${shadow}:`, 'g'))!.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the brand in the blue family in both themes', () => {
    for (const tokens of Object.values(themes)) {
      const hex = tokens['--primary']!
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
      expect(b! > r! && b! > g!, hex).toBe(true)
    }
  })

  it('passes AA (4.5:1) for every text pairing the components use', () => {
    for (const [theme, t] of Object.entries(themes)) {
      const pairs: [string, string, string][] = [
        ['primary-foreground on primary', t['--primary-foreground']!, t['--primary']!],
        ['muted-foreground on card', t['--muted-foreground']!, t['--card']!],
        ['neutral-11 on neutral-3', t['--neutral-11']!, t['--neutral-3']!],
        ['neutral-1 on neutral-12', t['--neutral-1']!, t['--neutral-12']!],
        ...TONES.flatMap(tone => [
          [`${tone}-fg on ${tone}-soft`, t[`--tone-${tone}-fg`]!, t[`--tone-${tone}-soft`]!],
          [`${tone}-fg on card`, t[`--tone-${tone}-fg`]!, t['--card']!],
        ] as [string, string, string][]),
      ]
      for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), `${theme}: ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('passes AA for Studio text, badges, notes and buttons in both themes', () => {
    const studioCss = readFileSync('components/dashboard/conversation-studio.css', 'utf8')
    for (const [theme, selector] of [['light', '#aiso-studio'], ['dark', '.dark #aiso-studio']] as const) {
      const tokens = { ...themes[theme], ...block(selector, studioCss) }
      const value = (name: string) => {
        const raw = tokens[name]!
        return raw.startsWith('var(') ? tokens[raw.slice(4, -1)]! : raw
      }
      const pairs = [
        ...['--as-bg', '--as-panel', '--as-side', '--as-soft'].flatMap(bg => [['--as-ink', bg], ['--as-muted', bg]]),
        ...['--as-bg', '--as-panel', '--as-soft'].map(bg => ['--as-blue', bg]),
        ['--as-warn', '--as-warnbg'], ['--as-onblue', '--as-blue'],
      ]
      for (const [fg, bg] of pairs) expect(contrast(value(fg!), value(bg!)), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
