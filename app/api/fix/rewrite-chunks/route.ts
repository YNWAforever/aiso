import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'
import { authorizeAiTool, consumeAiToolAllowance } from '@/lib/fix/guard'
import { readLimitedJson } from '@/lib/approvals/request'

const REWRITE_FORMAT: JsonSchemaFormat = {
  name: 'chunk_rewrite',
  schema: {
    type: 'object',
    properties: {
      rewritten: { type: 'string' },
      changes: { type: 'array', items: { type: 'string' } },
    },
    required: ['rewritten', 'changes'],
    additionalProperties: false,
  },
}

export async function POST(req: NextRequest) {
  // No id in the body — nothing to own-check, but the LLM call is still paid-for,
  // so plan and allowance are what bound it (lib/fix/guard.ts).
  const access = await authorizeAiTool({ paidOnly: true })
  if (!access.ok) return access.response

  let input: { chunkText: string; heading?: string; targetLength?: string }
  try {
    const raw = await readLimitedJson(req, 16384)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid')
    const body = raw as Record<string, unknown>
    if (typeof body.chunkText !== 'string' || !body.chunkText.trim()
      || (body.heading !== undefined && typeof body.heading !== 'string')
      || (body.targetLength !== undefined && (typeof body.targetLength !== 'string' || !body.targetLength.trim()))) throw new Error('invalid')
    input = body as typeof input
  } catch {
    return NextResponse.json({ error: 'Invalid rewrite request' }, { status: 400 })
  }
  const { chunkText, heading, targetLength = '600-1000 tokens' } = input

  const overAllowance = await consumeAiToolAllowance(access.accountId)
  if (overAllowance) return overAllowance

  const prompt = `Rewrite for AI citation potential.
HEADING: "${heading ?? 'Section'}", TARGET: ${targetLength}

Rules:
1. Direct answer in FIRST sentence
2. Concrete data point in SECOND sentence
3. Remove all dangling references (no "this", "above", "as mentioned")
4. Each paragraph must stand alone
5. Use lists where appropriate

ORIGINAL: ${chunkText.slice(0, 2000)}`

  // The default target alone is up to 1000 tokens, before the changes list and
  // the JSON around it. At 800 a truncated reply failed to parse and the route
  // silently returned the original text as if it were the rewrite.
  const res = await callOpenRouter({
    label: 'fix.rewrite_chunks',
    model: 'anthropic/claude-haiku-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2000,
    responseFormat: REWRITE_FORMAT,
  })
  let result: { rewritten?: string; changes?: string[] } = {}
  try { result = JSON.parse(res.match(/\{[\s\S]+\}/)?.[0] ?? '{}') } catch {}

  return NextResponse.json({ rewritten: result.rewritten ?? chunkText, changes: result.changes ?? [] })
}
