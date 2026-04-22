/**
 * run-pulse.mjs — replicates the n8n AI Pulse Weekly workflow locally
 * Usage: node scripts/run-pulse.mjs
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL   ?? ''
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY  ?? ''
const OR_KEY         = process.env.OPENROUTER_API_KEY          ?? ''
if (!SUPABASE_URL || !SUPABASE_KEY || !OR_KEY) {
  console.error('Missing env vars. Run: node --env-file=.env.local scripts/run-pulse.mjs')
  process.exit(1)
}
const OR_URL         = 'https://openrouter.ai/api/v1/chat/completions'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const PLATFORMS = [
  { key: 'perplexity',   model: 'perplexity/sonar' },
  { key: 'gpt4o',        model: 'openai/gpt-4o' },
  { key: 'claude-haiku', model: 'anthropic/claude-haiku-4-5' },
  { key: 'gemini-flash', model: 'google/gemini-2.0-flash-001' },
]

async function callOR(model, content, maxTokens, extra = {}) {
  const res = await fetch(OR_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aeo.fimmick.com',
      'X-Title': 'Fimmick AI Pulse',
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: maxTokens, ...extra }),
  })
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

async function processPrompt(prompt, scanWeek) {
  const { client_id, id: prompt_id, question, clients } = prompt
  const brandName = clients?.brand_name ?? 'Fimmick'

  // Query all 4 platforms in parallel
  const rawAnswers = await Promise.all(
    PLATFORMS.map(p =>
      callOR(p.model, question, 800)
        .catch(err => { console.warn(`    ⚠ ${p.key}: ${err.message.slice(0, 100)}`); return '' })
    )
  )

  // Analyse all 4 answers in one call (gpt-4o-mini, JSON mode)
  const analyseContent =
    `Brand: ${brandName}\nQuestion: ${question}\n\n` +
    PLATFORMS.map((p, i) => `=== ${p.key} ===\n${rawAnswers[i] || '(empty)'}`).join('\n\n') +
    `\n\nReturn ONLY a JSON object with key "results" containing an array of exactly 4 objects in the same platform order above.\n` +
    `Each object: {"platform":"<key>","brand_mentioned":<bool>,"sentiment":"positive|neutral|negative|not_mentioned","mention_position":<number|null>,"competitors_mentioned":[<strings>]}`

  let analyses = []
  try {
    const raw = await callOR('openai/gpt-4o-mini', analyseContent, 600, { response_format: { type: 'json_object' } })
    const parsed = JSON.parse(raw)
    analyses = Array.isArray(parsed) ? parsed : (parsed.results ?? parsed.analyses ?? parsed.platforms ?? [])
  } catch (err) {
    console.warn(`    ⚠ analyse parse failed: ${err.message.slice(0, 80)}`)
  }

  const rows = PLATFORMS.map((p, i) => {
    const a = analyses[i] ?? {}
    return {
      client_id,
      prompt_id,
      platform: p.key,
      question,
      raw_answer: rawAnswers[i] ?? '',
      brand_mentioned: a.brand_mentioned === true,
      sentiment: a.sentiment ?? 'not_mentioned',
      mention_position: a.mention_position != null ? Number(a.mention_position) : null,
      competitors_mentioned: Array.isArray(a.competitors_mentioned) ? a.competitors_mentioned : [],
      scan_week: scanWeek,
    }
  })

  const { error } = await supabase.from('pulse_metrics').insert(rows)
  if (error) console.warn(`    ⚠ DB insert: ${error.message}`)
}

async function computeSummary(scanWeek) {
  const { data: metrics } = await supabase
    .from('pulse_metrics')
    .select('client_id, platform, brand_mentioned')
    .eq('scan_week', scanWeek)

  if (!metrics?.length) return

  // Group: one entry per platform, one overall (platform=null)
  const groups = {}
  for (const m of metrics) {
    for (const key of [`${m.client_id}|${m.platform}`, `${m.client_id}|__all__`]) {
      if (!groups[key]) groups[key] = { client_id: m.client_id, platform: key.endsWith('__all__') ? null : m.platform, total: 0, mentions: 0 }
      groups[key].total++
      if (m.brand_mentioned) groups[key].mentions++
    }
  }

  // Delete any existing summary for this week, then insert fresh
  await supabase.from('pulse_weekly_summary').delete().in('client_id', [...new Set(metrics.map(m => m.client_id))]).eq('scan_week', scanWeek)

  const rows = Object.values(groups).map(g => ({
    client_id: g.client_id,
    scan_week: scanWeek,
    platform: g.platform,
    total_queries: g.total,
    brand_mentions: g.mentions,
    sov_score: Number((g.mentions / g.total * 100).toFixed(2)),
  }))

  const { error } = await supabase.from('pulse_weekly_summary').insert(rows)
  if (error) console.warn('Summary insert error:', error.message)
}

async function main() {
  const scanWeek = new Date().toISOString().slice(0, 10)
  console.log(`\n🚀  AI Pulse scan — ${scanWeek}\n`)

  const { data: prompts, error } = await supabase
    .from('prompt_bank')
    .select('id, client_id, question, clients!inner(brand_name, status)')
    .eq('is_active', true)
    .eq('clients.status', 'active')

  if (error) { console.error('Failed to fetch prompts:', error); process.exit(1) }
  console.log(`📋  ${prompts.length} active prompts\n`)

  // Process 4 at a time (parallel batches)
  const BATCH = 4
  for (let i = 0; i < prompts.length; i += BATCH) {
    await Promise.all(prompts.slice(i, i + BATCH).map(p => processPrompt(p, scanWeek)))
    process.stdout.write(`\r  ✓ ${Math.min(i + BATCH, prompts.length)}/${prompts.length}`)
  }
  console.log('\n\n📊  Computing weekly summary…')
  await computeSummary(scanWeek)

  const { data: summary } = await supabase
    .from('pulse_weekly_summary')
    .select('platform, total_queries, brand_mentions, sov_score')
    .eq('scan_week', scanWeek)
    .order('platform', { nullsFirst: true })

  console.log('\n✅  Results:')
  for (const r of summary ?? []) {
    const label = (r.platform ?? 'OVERALL').padEnd(16)
    const bar   = '█'.repeat(Math.round(r.sov_score / 5))
    console.log(`  ${label} ${String(r.sov_score).padStart(5)}%  ${bar}  (${r.brand_mentions}/${r.total_queries})`)
  }
  console.log(`\n🔗  https://fimmick-aeo.vercel.app/en/pulse/164e873f-4794-4743-9101-7901e5f03475\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
