/**
 * What a reader actually sees on a page, for checks that measure content.
 *
 * Stripping tags alone keeps the *text* of non-visible elements: head CSS
 * (`width:100%`), inline config and JSON-LD (`"year":2024`), comments,
 * <noscript> fallbacks and <template> markup. The GEO checks did exactly that,
 * so a three-word page scored as fact-dense on its stylesheet. serverText.ts
 * already stripped scripts and styles; this covers every check that reads text.
 */
const NON_VISIBLE_BLOCK = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const COMMENT = /<!--[\s\S]*?-->/g

/** The HTML with non-visible blocks and comments removed; visible markup is kept. */
export function stripNonVisible(html: string): string {
  return html.replace(COMMENT, ' ').replace(NON_VISIBLE_BLOCK, ' ')
}

/** The page's visible text, whitespace-collapsed. */
export function visibleText(html: string): string {
  return stripNonVisible(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
