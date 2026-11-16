/**
 * Safe Markdown subset for model output.
 *
 * Live answers arrive as Markdown, but they are untrusted text: nothing here
 * produces HTML, so the renderer never needs `dangerouslySetInnerHTML`. Raw
 * `<script>` and other tags stay plain text, and a link only becomes an anchor
 * when its URL parses as http(s) — `javascript:`, `data:` and relative targets
 * are rendered as text. The parser also stays usable on a streamed partial:
 * an unterminated fence, bold run or inline code never throws; it renders as
 * text until the closing marker arrives.
 */

export type StudioMarkdownInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type StudioMarkdownBlock =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: 3 | 4; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; language: string | null; text: string }

const BLANK = /^\s*$/
const FENCE = /^\s{0,3}```\s*([A-Za-z0-9_+.-]*)\s*$/
const HEADING = /^\s{0,3}(#{1,4})\s+(.*)$/
const UNORDERED = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const CONTINUATION = /^\s{1,}(.*)$/
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]{1,300}\]\([^)\s]{1,500}\))/g

function blockStarter(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || UNORDERED.test(line) || ORDERED.test(line)
}

/** Only absolute http(s) URLs survive. Everything else stays literal text. */
export function safeStudioHref(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // A URL object can normalise a value the input never contained; keep the
    // link only when its authority survived round-tripping.
    return url.hostname ? url.toString() : null
  } catch {
    return null
  }
}

export function parseStudioInline(text: string): StudioMarkdownInline[] {
  if (!text) return []
  const tokens: StudioMarkdownInline[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: 'text', text: text.slice(last, index) })
    const raw = match[0]
    if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ kind: 'strong', text: raw.slice(2, -2) })
    } else if (raw.startsWith('`')) {
      tokens.push({ kind: 'code', text: raw.slice(1, -1) })
    } else if (raw.startsWith('[')) {
      const link = raw.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/)
      const href = link ? safeStudioHref(link[2]) : null
      if (link && href) tokens.push({ kind: 'link', text: link[1], href })
      else tokens.push({ kind: 'text', text: raw })
    } else {
      tokens.push({ kind: 'em', text: raw.slice(1, -1) })
    }
    last = index + raw.length
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}

export function parseStudioMarkdown(source: string): StudioMarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: StudioMarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (BLANK.test(line)) {
      index += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1 // closing fence
      blocks.push({ kind: 'code', language: fence[1] || null, text: code.join('\n') })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length >= 3 ? 4 : 3, text: heading[2].trim() })
      index += 1
      continue
    }

    const quote = line.match(QUOTE)
    if (quote) {
      const quoteLines = [quote[1]]
      index += 1
      while (index < lines.length) {
        const next = lines[index].match(QUOTE)
        if (!next) break
        quoteLines.push(next[1])
        index += 1
      }
      blocks.push({ kind: 'quote', lines: quoteLines })
      continue
    }

    const unordered = line.match(UNORDERED)
    const ordered = unordered ? null : line.match(ORDERED)
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered)
      const items: string[] = []
      while (index < lines.length) {
        const next = isOrdered ? lines[index].match(ORDERED) : lines[index].match(UNORDERED)
        if (next) {
          items.push(next[1].trim())
          index += 1
          continue
        }
        const continuation = lines[index].match(CONTINUATION)
        if (items.length > 0 && continuation && !blockStarter(lines[index])) {
          items[items.length - 1] = `${items[items.length - 1]} ${continuation[1].trim()}`
          index += 1
          continue
        }
        break
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && !BLANK.test(lines[index])) {
      if (paragraph.length > 0 && blockStarter(lines[index])) break
      paragraph.push(lines[index].trimEnd())
      index += 1
    }
    blocks.push({ kind: 'paragraph', lines: paragraph })
  }
  return blocks
}
