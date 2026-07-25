import { NextRequest, NextResponse } from 'next/server'
import { supabase }       from '@/lib/supabase'
import { callOpenRouter } from '@/lib/openrouter'
import { getProfile }     from '@/lib/auth'
import { db }             from '@/lib/db'
import type { Scan }      from '@/lib/types'

export const dynamic = 'force-dynamic'

export function parseFixPack(raw: string): { llms_txt: string; robots_patch: string; faq_schema: string } {
  const match = raw.match(/\{[\s\S]*\}/)
  return JSON.parse(match?.[0] ?? raw)
}

// Ownership is checked via Neon because lib/supabase points at a deleted project.
// Anonymous scans (account_id is null) are public by design, so any signed-in
// user may generate a fix pack for one; owned scans are tenant-scoped.
async function canAccessScan(scanId: string, accountId: string): Promise<boolean> {
  const rows = await db()`
    select id from scans
    where id = ${scanId}
      and (account_id is null or account_id = ${accountId})
    limit 1
  `
  return rows.length > 0
}

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { scanId } = await req.json()
  if (!scanId) return NextResponse.json({ error: 'Missing scanId' }, { status: 400 })

  let allowed = false
  try {
    allowed = await canAccessScan(scanId, profile.account_id)
  } catch (error) {
    console.error('[fix] ownership check failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  // 404 rather than 403 so the endpoint does not leak scan existence
  if (!allowed) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })

  // Return cached result if exists
  const { data: existing } = await supabase
    .from('fix_packs')
    .select('llms_txt, robots_patch, faq_schema')
    .eq('scan_id', scanId)
    .maybeSingle()

  if (existing) return NextResponse.json(existing)

  const { data: scanData, error: scanError } = await supabase
    .from('scans')
    .select('*')
    .eq('id', scanId)
    .single()
  const scan = scanData as Scan | null

  if (scanError || !scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })

  let pageTitle = scan.domain
  let metaDescription = ''
  try {
    const res = await fetch(scan.url, { signal: AbortSignal.timeout(8000) })
    const html = await res.text()
    const t = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (t) pageTitle = t[1].trim()
    const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    if (m) metaDescription = m[1].trim()
  } catch { /* use defaults */ }

  const issues = Object.entries(scan.results as unknown as Record<string, { status: string; message: string }>)
    .filter(([, v]) => v.status !== 'pass')
    .map(([k, v]) => `${k}: ${v.message}`)

  const raw = await callOpenRouter({
    model: 'anthropic/claude-haiku-4-5',
    maxTokens: 2000,
    messages: [{
      role: 'user',
      content: `你係 AEO 專家。根據以下掃描結果，生成 3 個修復檔案：
1. llms.txt（根據網站描述）
2. robots.txt AI section（只需新增部份）
3. FAQPage JSON-LD（2–3 條 FAQ）

網站：${scan.domain}
描述：${pageTitle} - ${metaDescription}
問題：${JSON.stringify(issues)}

輸出 JSON（只輸出 JSON，無其他文字）：{ "llms_txt": "...", "robots_patch": "...", "faq_schema": "..." }`,
    }],
  })

  let parsed: { llms_txt: string; robots_patch: string; faq_schema: string }
  try {
    parsed = parseFixPack(raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse LLM response' }, { status: 500 })
  }

  await supabase.from('fix_packs').insert({ scan_id: scanId, ...parsed })

  return NextResponse.json(parsed)
}
