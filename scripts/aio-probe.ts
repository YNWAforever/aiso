/**
 * Measures, for one brand, how often Google shows an AI Overview for its active
 * monitoring questions in the configured market (default Hong Kong / zh-TW), and
 * whether that overview names the brand or its recorded competitors.
 *
 * This is the evidence needed before Pro/Enterprise plans switch their fifth
 * platform from Perplexity Pro to Google AI Overviews: if Google rarely shows an
 * overview for these questions, the switch would record "absent" most weeks and
 * make visibility less accurate, not more.
 *
 *   npm run aio:probe -- --client <client uuid>          # dry run: lists questions, spends nothing
 *   npm run aio:probe -- --client <client uuid> --yes    # one billed DataForSEO task per question
 *
 * Reads DATABASE_URL (read-only SELECTs) and DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
 * Writes nothing. Prints no credential or connection string.
 */
import { neon } from '@neondatabase/serverless'
// @ts-expect-error -- node requires the extension, tsc forbids it
import { aiOverviewConfig, fetchAiOverview, namesMentioned } from '../lib/integrations/dataforseo/ai-overview.ts'

const MAX_QUESTIONS = 10

function arg(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function main(): Promise<number> {
  const clientId = arg('--client')
  const spend = process.argv.includes('--yes')
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) {
    console.error('Usage: npm run aio:probe -- --client <client uuid> [--yes]')
    return 2
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); return 2 }
  const sql = neon(process.env.DATABASE_URL)

  let brand: string, aliases: string[], competitors: string[], questions: string[]
  try {
    const client = (await sql`select brand_name from clients where id = ${clientId} limit 1`)[0] as { brand_name?: string } | undefined
    if (!client?.brand_name) { console.error('No brand with that id.'); return 1 }
    brand = client.brand_name
    const entity = (await sql`select aliases from client_entities where client_id = ${clientId} limit 1`)[0] as { aliases?: unknown } | undefined
    aliases = Array.isArray(entity?.aliases) ? entity.aliases.filter((a): a is string => typeof a === 'string') : []
    // Mirrors listCompetitors (lib/competitors/store.ts), which this plain-Node
    // script cannot import: archived rows excluded, legacy array names merged.
    const live = (await sql`select name from competitors where client_id = ${clientId} and archived_at is null order by created_at, id`)
      .map(row => String((row as { name: unknown }).name).trim()).filter(Boolean)
    const legacyRow = (await sql`select competitors from clients where id = ${clientId} limit 1`)[0] as { competitors?: unknown } | undefined
    const known = new Set(live.map(name => name.toLowerCase()))
    competitors = [...live]
    for (const value of Array.isArray(legacyRow?.competitors) ? legacyRow.competitors : []) {
      const name = typeof value === 'string' ? value.trim() : ''
      if (name && !known.has(name.toLowerCase())) { known.add(name.toLowerCase()); competitors.push(name) }
    }
    questions = (await sql`
      select question from prompt_bank
      where client_id = ${clientId} and is_active = true
      order by created_at, id limit ${MAX_QUESTIONS}
    `).map(row => String((row as { question: unknown }).question))
  } catch {
    // The driver's own error text can include the connection string.
    console.error('Database read failed. Check DATABASE_URL with scripts/verify-db-connection.mjs.')
    return 1
  }

  console.log(`Brand: ${brand}${aliases.length ? ` (also: ${aliases.join(', ')})` : ''}`)
  console.log(`Competitors: ${competitors.length ? competitors.join(', ') : '(none recorded)'}`)
  console.log(`Active questions: ${questions.length}`)
  if (!questions.length) return 0
  if (!spend) {
    questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`))
    console.log(`\nDry run. Re-run with --yes to spend ${questions.length} DataForSEO SERP task(s) with AI Overviews.`)
    return 0
  }

  const config = aiOverviewConfig(process.env)
  if (!config) { console.error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set.'); return 2 }
  console.log(`Market: location ${config.locationCode}, language ${config.languageCode}\n`)

  let present = 0, brandNamed = 0, competitorNamed = 0, failed = 0
  for (const [i, question] of questions.entries()) {
    const result = await fetchAiOverview(question, config)
    if (result.status === 'present') {
      present++
      const ownNames = namesMentioned(result.text, [brand, ...aliases])
      const rivals = namesMentioned(result.text, competitors)
      if (ownNames.length) brandNamed++
      if (rivals.length) competitorNamed++
      console.log(`${i + 1}. AI Overview shown · brand ${ownNames.length ? 'named' : 'not named'}${rivals.length ? ` · competitors: ${rivals.join(', ')}` : ''} · ${result.references.length} source(s)\n   ${question}`)
    } else if (result.status === 'absent') {
      console.log(`${i + 1}. No AI Overview\n   ${question}`)
    } else {
      failed++
      console.log(`${i + 1}. Request failed (${result.reason}${result.code ? ` ${result.code}` : ''})\n   ${question}`)
    }
  }
  const answered = questions.length - failed
  const pct = (n: number, d: number) => d ? `${Math.round((n / d) * 100)}%` : 'n/a'
  console.log(`\nAI Overview shown: ${present}/${answered} (${pct(present, answered)})`)
  console.log(`Brand named in an overview: ${brandNamed}/${present} (${pct(brandNamed, present)})`)
  console.log(`A competitor named: ${competitorNamed}/${present} (${pct(competitorNamed, present)})`)
  if (failed) console.log(`Failed requests: ${failed}`)
  return 0
}

process.exitCode = await main()
