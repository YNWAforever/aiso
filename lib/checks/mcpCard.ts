import type { CheckResult } from '@/lib/types'

const AI_ENDPOINTS = ['/.well-known/mcp.json', '/.well-known/ai.json', '/.well-known/openai.json', '/ai-plugin.json']
// Match: rel="mcp" (MCP card spec), rel="ai-plugin", or meta name="ai:..."
const AI_META_RE   = /<(?:link[^>]+rel=["'](?:mcp|ai-plugin)["']|meta[^>]+name=["']ai[:\w])/i

export async function checkMcpCard(baseUrl: string, html: string): Promise<CheckResult> {
  // Check well-known AI endpoints
  for (const path of AI_ENDPOINTS) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { 'User-Agent': 'FimmickAISO/1.0' },
        signal: AbortSignal.timeout(6_000),
      })
      if (res.ok) {
        return { status: 'pass', message: 'mcp_card_found', details: path }
      }
    } catch { /* try next */ }
  }

  // Fallback: check HTML for AI meta tags
  if (AI_META_RE.test(html)) {
    return { status: 'warn', message: 'mcp_card_meta_only' }
  }

  return { status: 'fail', message: 'mcp_card_missing' }
}
