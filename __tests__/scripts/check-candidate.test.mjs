import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, vi } from 'vitest'
import { parseArguments, runCandidateCheck, main } from '../../scripts/readiness/check-candidate.mjs'
import { validateReport, hashPolicy } from '../../scripts/readiness/candidate-contract.mjs'
import fixture from '../fixtures/runtime-candidate.json' with { type: 'json' }

const clone = () => structuredClone(fixture)
const options = () => ({ expected: clone().report.expected, policy: clone().policy, outputDir: 'synthetic-output', vercelToken: 'vercel-sentinel', readinessSecret: 'readiness-sentinel', bypassSecret: 'bypass-sentinel' })
function harness(change = () => {}) {
  const data = clone(); change(data)
  const calls = []; const writes = []
  const ports = {
    now: () => Date.parse('2026-09-08T01:00:02.000Z'),
    nonce: () => fixture.report.nonce,
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(init.method === 'POST' ? data.report : data.metadata)) },
    mkdir: async () => {},
    writeFile: async (...args) => { writes.push(args) },
  }
  return { data, calls, writes, ports }
}
describe('manual candidate boundary', () => {
  it('verifies metadata twice around one credential-separated probe and writes exclusive sanitized artifacts', async () => {
    const h = harness(); const result = await runCandidateCheck(options(), h.ports)
    expect(result.exitCode).toBe(0); expect(result.report.productionReady).toBe(false)
    expect(h.calls.map(c => c.init.method)).toEqual(['GET', 'POST', 'GET'])
    expect(h.calls[0].url).toContain('teamId=team_test&withGitRepoInfo=true')
    expect(h.calls[1].url).toBe('https://candidate-hash-team.vercel.app/api/internal/readiness')
    for (const c of [h.calls[0], h.calls[2]]) {
      expect(c.init.headers).toEqual({ Authorization: 'Bearer vercel-sentinel' })
      expect(c.init.redirect).toBe('error')
    }
    expect(h.calls[1].init.headers.Authorization).toBe('Bearer readiness-sentinel')
    expect(h.calls[1].init.headers['x-vercel-protection-bypass']).toBe('bypass-sentinel')
    expect(h.writes).toHaveLength(2)
    expect(h.writes.every(w => w[2].flag === 'wx')).toBe(true)
    expect(JSON.stringify(h.writes)).not.toContain('sentinel')
  })
  it.each(['ownerId', 'projectId', 'id', 'url', 'readyState'])('rejects missing full metadata field %s before probe', async key => {
    const h = harness(d => { delete d.metadata[key] })
    await expect(runCandidateCheck(options(), h.ports)).rejects.toThrow('Candidate verification failed')
    expect(h.calls).toHaveLength(1); expect(h.writes).toHaveLength(0)
  })
  it('rejects source disagreement and post-read drift', async () => {
    const h = harness(d => { d.metadata.gitSource.sha = 'c'.repeat(40) })
    await expect(runCandidateCheck(options(), h.ports)).rejects.toThrow()
    const second = harness(); const fetch = second.ports.fetch
    second.ports.fetch = async (...args) => { if (second.calls.length === 2) second.data.metadata.url = 'changed.vercel.app'; return fetch(...args) }
    await expect(runCandidateCheck(options(), second.ports)).rejects.toThrow()
    expect(second.writes).toHaveLength(0)
  })
  it.each([
    r => { r.runtimeStatus = 'fail' },
    r => { r.nonce = '0'.repeat(32) },
    r => { r.policyHash = '0'.repeat(64) },
    r => { r.completedAt = '2099-01-01T00:00:00.000Z' },
    r => { r.startedAt = 'invalid' },
    r => { r.startedAt = '2026-09-07T01:00:00.000Z' },
    r => { delete r.configuredTeamId },
    r => { r.observed.projectId = null },
    r => { r.checks = r.checks.filter(c => c.id !== 'database.relation') },
    r => { r.checks = r.checks.filter(c => c.id !== 'configuration.core') },
    r => { r.configuration.checks[0].secret = 'injection' },
    r => { r.checks[0].code = 'unavailable' },
    r => { r.extra = 'injection' },
    r => { r.observedDatabase.role = 'owner'; },
  ])('rejects malformed, stale, incomplete or forged reports', async mutate => {
    const h = harness(d => mutate(d.report))
    await expect(runCandidateCheck(options(), h.ports)).rejects.toThrow()
    expect(h.writes).toHaveLength(0)
  })
  it.each(['fail', 'unknown'])('preserves honest %s reports with exit 1', async status => {
    const h = harness(d => {
      Object.assign(d.report.checks.find(c => c.id === 'auth.jwks'), { status, code: status === 'fail' ? 'malformed_response' : 'timeout' })
      d.report.runtimeStatus = status
    })
    expect((await runCandidateCheck(options(), h.ports)).exitCode).toBe(1)
    expect(h.writes).toHaveLength(2)
  })
  it('rejects redirect and oversized bodies without artifacts', async () => {
    for (const response of [new Response('', { status: 302 }), new Response('x'.repeat(262145))]) {
      const h = harness(); h.ports.fetch = async () => response
      await expect(runCandidateCheck(options(), h.ports)).rejects.toThrow()
      expect(h.writes).toHaveLength(0)
    }
  })
  it('rejects overwrite, leaves first artifact when the second write fails', async () => {
    const h = harness(); const write = h.ports.writeFile
    h.ports.writeFile = async (...args) => { if (h.writes.length) throw new Error('private filesystem detail'); return write(...args) }
    await expect(runCandidateCheck(options(), h.ports)).rejects.toThrow('Candidate verification failed')
    expect(h.writes).toHaveLength(1)
  })
  it('validates CLI parsing and serialized policy boundary through main', async () => {
    const argv = ['--team','team_test','--project','prj_test','--deployment','dpl_test','--sha','b'.repeat(40),'--environment','preview','--policy','synthetic.json','--output-dir','synthetic-output']
    expect(parseArguments(argv).expected).toEqual(options().expected)
    for (const extra of [['--url','https://evil.test'], ['--token','secret'], ['--team','duplicate']]) expect(() => parseArguments([...argv,...extra])).toThrow()
    expect(() => parseArguments(argv.slice(2))).toThrow()
    const h = harness(); const output = []
    expect(await main(argv, { VERCEL_TOKEN:'vercel-sentinel', READINESS_PROBE_SECRET:'readiness-sentinel' }, { ...h.ports, readFile: async () => JSON.stringify(h.data.policy), log: s => output.push(s) })).toBe(0)
    expect(JSON.stringify(output)).not.toContain('sentinel')
    expect(hashPolicy(h.data.policy)).toBe(h.data.report.policyHash)
    expect(validateReport(h.data.report, { expected: options().expected, policy: h.data.policy, nonce: h.data.report.nonce, now: h.ports.now() })).toEqual(h.data.report)
  })
})
describe('runner transport and filesystem edges', () => {
  it('enforces exactly 20 seconds through a stalled response body and cancels it', async () => {
    vi.useFakeTimers()
    try {
      const h = harness(); let signal; let cancelled = false
      h.ports.fetch = async (_url, init) => { signal = init.signal; return new Response(new ReadableStream({ cancel() { cancelled = true } })) }
      const promise = runCandidateCheck(options(), h.ports)
      const assertion = expect(promise).rejects.toThrow('Candidate verification failed')
      await vi.advanceTimersByTimeAsync(19999)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await assertion
      expect(signal.aborted).toBe(true); expect(cancelled).toBe(true)
      expect(h.writes).toHaveLength(0)
    } finally { vi.useRealTimers() }
  })
  it('bounds a fetch that ignores abort and cancels its late body', async () => {
    vi.useFakeTimers()
    try {
      const h = harness(); let finish; let cancelled = false
      h.ports.fetch = () => new Promise(resolve => { finish = resolve })
      const promise = runCandidateCheck(options(), h.ports)
      const assertion = expect(promise).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(20000); await assertion
      finish(new Response(new ReadableStream({ cancel() { cancelled = true } })))
      await vi.advanceTimersByTimeAsync(0)
      expect(cancelled).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('serializes actual files and refuses existing nonce paths without replacing their content', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'aiso-readiness-test-'))
    const h = harness()
    const result = await runCandidateCheck({ ...options(), outputDir }, { ...h.ports, mkdir: undefined, writeFile: undefined,
      // Use real filesystem ports only in a fresh synthetic directory.
      ...(await import('node:fs/promises')),
    })
    expect(JSON.parse(await readFile(result.jsonPath, 'utf8'))).toEqual(h.data.report)
    expect(await readFile(result.markdownPath, 'utf8')).toContain('REPORT ONLY / NOT ENFORCED')
    await writeFile(result.jsonPath, 'existing-sentinel')
    await expect(runCandidateCheck({ ...options(), outputDir }, { ...h.ports, ...(await import('node:fs/promises')) })).rejects.toThrow()
    expect(await readFile(result.jsonPath, 'utf8')).toBe('existing-sentinel')
  })
  it('has no import side effects and actual CLI rejects secret arguments with fixed output', () => {
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/readiness/check-candidate.mjs')"], { encoding: 'utf8' })
    expect(imported.status).toBe(0); expect(imported.stdout).toBe(''); expect(imported.stderr).toBe('')
    const result = spawnSync(process.execPath, ['scripts/readiness/check-candidate.mjs', '--token', 'private-sentinel'], { encoding: 'utf8' })
    expect(result.status).toBe(1); expect(result.stdout).toContain('Candidate verification failed')
    expect(result.stdout + result.stderr).not.toContain('private-sentinel')
  })
  it.each([
    d => { d.metadata.ownerId = 'team_other' }, d => { d.metadata.target = 'production' },
    d => { d.metadata.readyState = 'BUILDING' }, d => { d.metadata.url = 'https://evil.test' },
    d => { d.metadata.url = 'https://x.vercel.app/path' }, d => { d.metadata.url = 'https://x.vercel.app:443' },
    d => { d.metadata.url = 'https://user@x.vercel.app' },
    d => { d.metadata.gitSource = {}; d.metadata.meta = {} },
  ])('blocks invalid target before sending readiness credential', async mutate => {
    const h = harness(mutate)
    await expect(runCandidateCheck(options(), h.ports)).rejects.toThrow()
    expect(h.calls.map(c => c.init.method)).toEqual(['GET'])
  })
})