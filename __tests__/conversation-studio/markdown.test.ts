import { describe, expect, it } from 'vitest'
import { parseStudioInline, parseStudioMarkdown, safeStudioHref } from '@/lib/conversation-studio/markdown'

describe('parseStudioMarkdown', () => {
  it('splits paragraphs on blank lines and keeps single line breaks inside one block', () => {
    const blocks = parseStudioMarkdown('First line\nsecond line.\n\nNext paragraph.')
    expect(blocks).toEqual([
      { kind: 'paragraph', lines: ['First line', 'second line.'] },
      { kind: 'paragraph', lines: ['Next paragraph.'] },
    ])
  })

  it('parses headings without allowing an h1/h2', () => {
    expect(parseStudioMarkdown('# Title\n## Section\n### Detail')).toEqual([
      { kind: 'heading', level: 3, text: 'Title' },
      { kind: 'heading', level: 3, text: 'Section' },
      { kind: 'heading', level: 4, text: 'Detail' },
    ])
  })

  it('groups ordered and unordered lists separately', () => {
    expect(parseStudioMarkdown('- one\n- two\n\n1. first\n2. second')).toEqual([
      { kind: 'list', ordered: false, items: ['one', 'two'] },
      { kind: 'list', ordered: true, items: ['first', 'second'] },
    ])
  })

  it('keeps indented continuation text with its list item', () => {
    expect(parseStudioMarkdown('- first item\n  continued here\n- second')).toEqual([
      { kind: 'list', ordered: false, items: ['first item continued here', 'second'] },
    ])
  })

  it('keeps fenced code intact, including raw HTML text', () => {
    const source = 'Before\n```html\n<script>alert(1)</script>\n```\nAfter'
    expect(parseStudioMarkdown(source)).toEqual([
      { kind: 'paragraph', lines: ['Before'] },
      { kind: 'code', language: 'html', text: '<script>alert(1)</script>' },
      { kind: 'paragraph', lines: ['After'] },
    ])
  })

  it('renders an unterminated fence as code instead of throwing', () => {
    expect(parseStudioMarkdown('```js\nconst a = 1')).toEqual([
      { kind: 'code', language: 'js', text: 'const a = 1' },
    ])
  })

  it('parses quotes', () => {
    expect(parseStudioMarkdown('> quoted\n> more')).toEqual([{ kind: 'quote', lines: ['quoted', 'more'] }])
  })
})

describe('parseStudioInline', () => {
  it('parses bold, italic, inline code and safe links', () => {
    expect(parseStudioInline('a **b** *c* `d` [e](https://example.com/x)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'e', href: 'https://example.com/x' },
    ])
  })

  it('leaves raw HTML as text', () => {
    expect(parseStudioInline('<script>alert(1)</script>')).toEqual([{ kind: 'text', text: '<script>alert(1)</script>' }])
  })

  it('never turns an unsafe scheme into a link', () => {
    for (const raw of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](/relative/path)', '[x](ftp://example.com/a)']) {
      const tokens = parseStudioInline(raw)
      expect(tokens.some(token => token.kind === 'link')).toBe(false)
      // The whole unsafe string survives as literal text (possibly split by the
      // plain-text scanner), never as an anchor.
      expect(tokens.map(token => token.kind === 'text' ? token.text : `[${token.text}]`).join('')).toBe(raw)
    }
  })

  it('does not break an unclosed marker from a streamed partial', () => {
    expect(parseStudioInline('**bold so far')).toEqual([{ kind: 'text', text: '**bold so far' }])
    expect(parseStudioInline('a `code')).toEqual([{ kind: 'text', text: 'a `code' }])
  })

  it('keeps a trailing empty input empty', () => {
    expect(parseStudioInline('')).toEqual([])
  })
})

describe('safeStudioHref', () => {
  it('accepts absolute http(s) and rejects other schemes or relative paths', () => {
    expect(safeStudioHref('https://example.com/source?q=1')).toBe('https://example.com/source?q=1')
    expect(safeStudioHref('http://example.com')).toBe('http://example.com/')
    expect(safeStudioHref('javascript:alert(1)')).toBeNull()
    expect(safeStudioHref('data:text/html,hi')).toBeNull()
    expect(safeStudioHref('/dashboard')).toBeNull()
    expect(safeStudioHref('not a url')).toBeNull()
  })
})
