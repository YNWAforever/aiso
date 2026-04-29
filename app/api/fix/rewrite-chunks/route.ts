import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter } from '@/lib/openrouter'

export async function POST(req: NextRequest) {
  const { chunkText, heading, targetLength = '600-1000 tokens' } = await req.json()
  if (!chunkText) return NextResponse.json({ error: 'chunkText required' }, { status: 400 })

  const prompt = `Rewrite for AI citation potential.
HEADING: "${heading ?? 'Section'}", TARGET: ${targetLength}

Rules:
1. Direct answer in FIRST sentence
2. Concrete data point in SECOND sentence
3. Remove all dangling references (no "this", "above", "as mentioned")
4. Each paragraph must stand alone
5. Use lists where appropriate

ORIGINAL: ${chunkText.slice(0, 2000)}

Return JSON: {"rewritten": "text", "changes": ["change list"]}`

  const res = await callOpenRouter({ model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: prompt }], maxTokens: 800 })
  let result: { rewritten?: string; changes?: string[] } = {}
  try { result = JSON.parse(res.match(/\{[\s\S]+\}/)?.[0] ?? '{}') } catch {}

  return NextResponse.json({ rewritten: result.rewritten ?? chunkText, changes: result.changes ?? [] })
}
