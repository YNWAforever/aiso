/**
 * Readback for the AISO cron Worker: what schedules are actually deployed,
 * compared with cloudflare/aiso-worker/wrangler.jsonc.
 *
 * This exists because committing a cron array activates nothing. On 2026-11-09
 * the live Worker ran `17 4 * * *` (Pulse) and `47 7 * * 1` (alerts) only: the
 * `17 16 * * *` brand-months tick that PR #180 added to the deployable config
 * had never been deployed, so `brand_month_snapshots` could not be written
 * automatically and every month page read "not recorded". The failure mode is
 * silent — nothing here errors, a cron simply never fires — so the release
 * packet and any "why did this never run?" question should start with this
 * readback rather than the repository config.
 *
 * Usage:  npm run worker:schedules            (human output, exit 1 on drift)
 *         npm run worker:schedules -- --json  (machine output)
 *
 * Auth:  CLOUDFLARE_API_TOKEN, or the local `wrangler login` OAuth token.
 *        The token is never printed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_PATH = 'cloudflare/aiso-worker/wrangler.jsonc'
const API = 'https://api.cloudflare.com/client/v4'

/** Configured cron strings, validated against the JSONC deployable config. */
export function configuredCrons(config) {
  const crons = config?.triggers?.crons
  if (!Array.isArray(crons) || crons.length === 0 || crons.some(cron => typeof cron !== 'string' || !cron.trim())) {
    throw new Error(`${CONFIG_PATH} has no usable triggers.crons array`)
  }
  return [...new Set(crons.map(cron => cron.trim()))].sort()
}

/** What the deployed Worker has, compared with the config. Non-empty drift means the Worker is stale. */
export function compareSchedules(configured, deployed) {
  const deployedList = [...new Set((deployed ?? []).map(entry => entry?.cron).filter(cron => typeof cron === 'string'))].sort()
  const configuredSet = new Set(configured), deployedSet = new Set(deployedList)
  return {
    configured, deployed: deployedList,
    missing: configured.filter(cron => !deployedSet.has(cron)),
    extra: deployedList.filter(cron => !configuredSet.has(cron)),
    drift: configured.some(cron => !deployedSet.has(cron)) || deployedList.some(cron => !configuredSet.has(cron)),
  }
}

function oauthToken() {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml') : null,
    join(homedir(), '.config', '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.wrangler', 'config', 'default.toml'),
  ].filter(Boolean)
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const match = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(path, 'utf8'))
    if (match) return match[1]
  }
  return null
}

async function main() {
  const json = process.argv.includes('--json')
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  const configured = configuredCrons(config)
  const accountId = config?.account_id, script = config?.name
  if (typeof accountId !== 'string' || typeof script !== 'string') throw new Error(`${CONFIG_PATH} is missing account_id or name`)

  const token = process.env.CLOUDFLARE_API_TOKEN ?? oauthToken()
  if (!token) throw new Error('No Cloudflare credential: set CLOUDFLARE_API_TOKEN or run `wrangler login`')

  const response = await fetch(`${API}/accounts/${accountId}/workers/scripts/${script}/schedules`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json()
  if (!response.ok || !body?.success) {
    const codes = (body?.errors ?? []).map(error => error?.code).filter(Boolean)
    throw new Error(`Cloudflare readback failed (${response.status}${codes.length ? `, codes ${codes.join(',')}` : ''})`)
  }
  const result = compareSchedules(configured, body.result?.schedules)
  // Deployment evidence for the packet: when the schedules and script last changed.
  if (json) { console.log(JSON.stringify({ script, ...result }));
  } else {
    console.log(`Worker ${script}`)
    console.log(`  configured (${CONFIG_PATH}): ${result.configured.join(', ')}`)
    for (const entry of body.result?.schedules ?? []) {
      console.log(`  deployed:   ${entry.cron}  (modified ${entry.modified_on ?? 'unknown'})`)
    }
    if (result.missing.length) console.log(`  MISSING from the deployed Worker: ${result.missing.join(', ')}`)
    if (result.extra.length) console.log(`  DEPLOYED but not in the config: ${result.extra.join(', ')}`)
    if (!result.drift) console.log('  no drift: the deployed schedules match the config')
  }
  if (result.drift) process.exitCode = 1
}

if (process.argv[1] && process.argv[1].endsWith('worker-schedules.mjs')) {
  main().catch(error => { console.error(`worker-schedules: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
