import { randomBytes } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson, hashPolicy, validateCandidate, validatePolicy, verifyMetadata, validateReport, renderReport } from './candidate-contract.mjs'

const failure = () => new Error('Candidate verification failed')
export function parseArguments(args) {
  const names = ['team','project','deployment','sha','environment','policy','output-dir']
  const values = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2)
    if (args[i] !== '--' + key || !names.includes(key) || key in values || typeof args[i+1] !== 'string' || !args[i+1].trim() || args[i+1].startsWith('--')) throw failure()
    values[key] = args[i+1]
  }
  if (Object.keys(values).length !== names.length) throw failure()
  return {
    expected: validateCandidate({ teamId: values.team, projectId: values.project, deploymentId: values.deployment, commitSha: values.sha, environment: values.environment }),
    policyPath: values.policy, outputDir: values['output-dir'],
  }
}

// The deadline covers fetch AND the streamed response body, even for a transport that
// ignores AbortSignal. Late response bodies are cancelled; no automatic retries.
async function jsonRequest(fetchPort, url, init, timers) {
  const controller = new AbortController()
  let response; let reader; let expired = false
  let timer
  const operation = (async () => {
    response = await fetchPort(url, { ...init, redirect: 'error', signal: controller.signal })
    if (expired) { await response.body?.cancel().catch(() => {}); throw failure() }
    if (response.status !== 200 || response.redirected || !response.body) throw failure()
    reader = response.body.getReader()
    const chunks = []; let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 256 * 1024) throw failure()
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  })()
  const timeout = new Promise((_, reject) => {
    timer = timers.setTimeout(() => { expired = true; controller.abort(); reject(failure()) }, 20000)
  })
  try { return await Promise.race([operation, timeout]) }
  finally {
    timers.clearTimeout(timer); controller.abort()
    // Cancellation is best-effort, never awaited: an uncooperative source cannot
    // extend the deadline. Locked readers and unlocked rejected responses differ.
    if (reader) { void reader.cancel().catch(() => {}) }
    else if (response?.body) { void response.body.cancel().catch(() => {}) }
  }
}

export async function runCandidateCheck(options, ports = {}) {
  const io = { fetch: globalThis.fetch, now: Date.now, nonce: () => randomBytes(16).toString('hex'), mkdir, writeFile, setTimeout, clearTimeout, ...ports }
  try {
    const expected = validateCandidate(options.expected)
    const policy = validatePolicy(options.policy)
    if (typeof options.outputDir !== 'string' || !options.outputDir.trim()) throw failure()
    for (const secret of [options.vercelToken, options.readinessSecret]) if (typeof secret !== 'string' || !secret || /[\r\n]/.test(secret)) throw failure()
    if (options.bypassSecret !== undefined && (typeof options.bypassSecret !== 'string' || !options.bypassSecret || /[\r\n]/.test(options.bypassSecret))) throw failure()
    const nonce = io.nonce()
    if (!/^[a-f0-9]{32}$/.test(nonce)) throw failure()
    const request = { schemaVersion: 1, nonce, expected, policyHash: hashPolicy(policy), policy }
    const body = canonicalJson(request)
    if (Buffer.byteLength(body) > 16384) throw failure()
    const metadataUrl = 'https://api.vercel.com/v13/deployments/' + encodeURIComponent(expected.deploymentId) + '?teamId=' + encodeURIComponent(expected.teamId) + '&withGitRepoInfo=true'
    const metadataInit = { method: 'GET', headers: { Authorization: 'Bearer ' + options.vercelToken } }
    const origin = verifyMetadata(await jsonRequest(io.fetch, metadataUrl, metadataInit, io), expected)
    const headers = { Authorization: 'Bearer ' + options.readinessSecret, 'Content-Type': 'application/json' }
    if (options.bypassSecret) headers['x-vercel-protection-bypass'] = options.bypassSecret
    const wireReport = await jsonRequest(io.fetch, origin + '/api/internal/readiness', { method: 'POST', headers, body }, io)
    // Always reread control-plane metadata before accepting the returned artifact.
    const after = verifyMetadata(await jsonRequest(io.fetch, metadataUrl, metadataInit, io), expected)
    if (after !== origin) throw failure()
    const report = validateReport(wireReport, { expected, policy, nonce, now: io.now() })
    const json = canonicalJson(report) + '\n'
    const markdown = renderReport(report)
    // A secret accidentally matching a legitimate field must still never be emitted.
    for (const secret of [options.vercelToken, options.readinessSecret, options.bypassSecret].filter(Boolean)) if (json.includes(secret) || markdown.includes(secret)) throw failure()
    const dir = resolve(options.outputDir)
    await io.mkdir(dir, { recursive: true })
    const basename = join(dir, 'readiness-' + nonce)
    // Each write is exclusive. If Markdown fails, retain the valid JSON artifact;
    // never remove or replace a pre-existing file to simulate pair atomicity.
    await io.writeFile(basename + '.json', json, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await io.writeFile(basename + '.md', markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return { exitCode: report.runtimeStatus === 'pass' && report.configurationStatus === 'pass' ? 0 : 1, report, jsonPath: basename + '.json', markdownPath: basename + '.md' }
  } catch { throw failure() }
}

export async function main(args = process.argv.slice(2), env = process.env, ports = {}) {
  const log = ports.log ?? (message => process.stdout.write(message + '\n'))
  try {
    const argsOptions = parseArguments(args)
    const text = await (ports.readFile ?? readFile)(argsOptions.policyPath, 'utf8')
    if (typeof text !== 'string' || Buffer.byteLength(text) > 16384) throw failure()
    const options = { ...argsOptions, policy: JSON.parse(text), vercelToken: env.VERCEL_TOKEN, readinessSecret: env.READINESS_PROBE_SECRET, ...(env.VERCEL_AUTOMATION_BYPASS_SECRET ? { bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) }
    const result = await runCandidateCheck(options, ports)
    log(result.exitCode === 0 ? 'Selected readiness checks passed. Production readiness remains unverified.' : 'Selected readiness checks failed or are unknown. Production readiness remains unverified.')
    return result.exitCode
  } catch { log('Candidate verification failed. No release approval was granted.'); return 1 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main()