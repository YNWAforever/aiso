import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5'

export interface GroundedFixPack { llms_txt: string; robots_patch: string; faq_schema: string }
type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const element = (node: HtmlNode): node is HtmlElement => 'tagName' in node
const attr = (node: HtmlElement, name: string): string | undefined => node.attrs.find(item => item.name === name)?.value
const children = (node: HtmlNode): HtmlNode[] => 'childNodes' in node ? node.childNodes : []

function hidden(node: HtmlElement): boolean {
  return attr(node, 'hidden') !== undefined || attr(node, 'aria-hidden')?.toLowerCase() === 'true'
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(attr(node, 'style') ?? '')
}

/** Explicit HTML visibility only; external CSS and script-generated content are not verified. */
function pageText(root: HtmlNode, skipHead = true): string {
  const stack = [root], text: string[] = []
  while (stack.length) {
    const node = stack.pop()!
    if (element(node) && (['script', 'style', 'noscript', 'template'].includes(node.tagName)
      || (skipHead && node.tagName === 'head') || hidden(node))) continue
    if ('value' in node && node.nodeName === '#text') text.push(node.value)
    const descendants = children(node)
    for (let index = descendants.length - 1; index >= 0; index--) stack.push(descendants[index]!)
  }
  return text.join(' ').replace(/\s+/g, ' ').trim()
}

function plainText(value: unknown): string {
  return typeof value === 'string' ? pageText(parseFragment(value), false).replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : ''
}
function activeElements(root: HtmlNode): HtmlElement[] {
  const stack = [root], nodes: HtmlElement[] = []
  while (stack.length) {
    const node = stack.pop()!
    if (element(node)) {
      if (node.tagName === 'template' || hidden(node)) continue
      nodes.push(node)
    }
    const descendants = children(node)
    for (let index = descendants.length - 1; index >= 0; index--) stack.push(descendants[index]!)
  }
  return nodes
}

/** Copy only bounded FAQ source pairs corroborated by non-hidden served page text. */
function sourceFaq(nodes: HtmlElement[], visible: string) {
  const pairs: Array<{ '@type': 'Question'; name: string; acceptedAnswer: { '@type': 'Answer'; text: string } }> = []
  for (const script of nodes.filter(node => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json').slice(0, 30)) {
    try {
      const parsed: unknown = JSON.parse(children(script).map(node => 'value' in node ? node.value : '').join(''))
      const records = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(object(parsed)['@graph']) ? object(parsed)['@graph'] as unknown[] : [])]
      for (const raw of records.slice(0, 30)) {
        const record = object(raw)
        if (record['@type'] !== 'FAQPage' || !Array.isArray(record.mainEntity)) continue
        for (const entry of record.mainEntity.slice(0, 30)) {
          const question = object(entry), answer = object(question.acceptedAnswer)
          const name = plainText(question.name), answerText = plainText(answer.text)
          if (question['@type'] !== 'Question' || answer['@type'] !== 'Answer'
            || !name || !answerText || name.length > 300 || answerText.length > 2000
            || !visible.includes(name) || !visible.includes(answerText)
            || pairs.some(pair => pair.name === name)) continue
          pairs.push({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text: answerText } })
          if (pairs.length === 3) return pairs
        }
      }
    } catch { /* Malformed source markup supplies no facts. */ }
  }
  return pairs
}

export function buildGroundedFixPack(url: string, html: string): GroundedFixPack {
  const origin = new URL(url).origin
  const document = parse(html)
  const nodes = activeElements(document)
  const head = nodes.find(node => node.tagName === 'head')
  const metadata = head ? activeElements(head) : []
  const titleNode = metadata.find(node => node.tagName === 'title')
  const title = titleNode ? pageText(titleNode, false).slice(0, 2000) : ''
  const descriptionNode = metadata.find(node => node.tagName === 'meta' && attr(node, 'name')?.toLowerCase() === 'description')
  const description = plainText(descriptionNode ? attr(descriptionNode, 'content') : undefined).slice(0, 2000)
  const faq = sourceFaq(nodes, pageText(document))
  return {
    llms_txt: [
      '# ' + new URL(origin).hostname,
      '',
      '> Review draft. Source quotes are not independently verified.',
      '',
      '## Observed source',
      '- Origin: ' + origin,
      ...(title ? ['- Page title (source quote): ' + JSON.stringify(title)] : []),
      ...(description ? ['- Meta description (source quote): ' + JSON.stringify(description)] : []),
      '',
      '## Evidence limits',
      html ? '- Site sections and business policies were not verified.' : '- Page content could not be fetched. Only the scan origin is known.',
      faq.length ? '- FAQ draft copies source pairs only; review before use.' : '- No supported FAQ pairs were found. The FAQ draft is empty and must not be published as a completed FAQ.',
    ].join('\n'),
    robots_patch: '# REVIEW REQUIRED: crawler access and training policies were not supplied.\n# No access directives generated. Confirm your policy before editing robots.txt.',
    faq_schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }, null, 2).replace(/</g, '\\u003c'),
  }
}
