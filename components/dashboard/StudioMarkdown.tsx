import { parseStudioInline, parseStudioMarkdown } from '@/lib/conversation-studio/markdown'

function Inline({ text }: { text: string }) {
  return <>{parseStudioInline(text).map((token, index) => token.kind === 'strong'
    ? <strong key={index}>{token.text}</strong>
    : token.kind === 'em'
      ? <em key={index}>{token.text}</em>
      : token.kind === 'code'
        ? <code key={index} className="as-md-code">{token.text}</code>
        : token.kind === 'link'
          ? <a key={index} href={token.href} target="_blank" rel="noopener noreferrer" className="underline">{token.text}</a>
          : <span key={index}>{token.text}</span>)}</>
}

/**
 * Renders the safe Markdown subset as React nodes. Nothing is injected as HTML,
 * so a streamed answer can render every delta without an XSS surface.
 */
export function StudioMarkdown({ text }: { text: string }) {
  return <div className="as-md">
    {parseStudioMarkdown(text).map((block, index) => {
      if (block.kind === 'paragraph') return <p key={index} className="as-md-paragraph">{block.lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}<Inline text={line} /></span>)}</p>
      if (block.kind === 'heading') return block.level === 3
        ? <h3 key={index} className="as-md-heading"><Inline text={block.text} /></h3>
        : <h4 key={index} className="as-md-heading"><Inline text={block.text} /></h4>
      if (block.kind === 'list') {
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)
        return block.ordered
          ? <ol key={index} className="as-md-list list-decimal">{items}</ol>
          : <ul key={index} className="as-md-list list-disc">{items}</ul>
      }
      if (block.kind === 'quote') return <blockquote key={index} className="as-md-quote">{block.lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}<Inline text={line} /></span>)}</blockquote>
      return <pre key={index} className="as-md-pre"><code>{block.text}</code></pre>
    })}
  </div>
}
