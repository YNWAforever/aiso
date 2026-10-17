import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'

const tools = await import('../../scripts/ci/local-auth-safety.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})
const runId = 'a1111111-1111-4111-8111-111111111111'
const imageId = `sha256:${'a'.repeat(64)}`
const containerId = 'b'.repeat(64)
const spec = () => tools.runSpec(runId, imageId)
const inspect = () => ({
  Id: containerId, Image: imageId,
  Config: { Labels: { 'com.aiso.local-auth.run': runId, 'com.aiso.local-auth.purpose': 'disposable-auth-browser' } },
  HostConfig: { Binds: null },
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55555' }] } },
})

describe('local real Auth harness safety boundaries', () => {
  it('selects a bounded scenario only from one explicit CLI option', () => {
    expect(typeof tools.parseLocalAuthScenario).toBe('function')
    expect(tools.parseLocalAuthScenario([])).toBe('first-value')
    expect(tools.parseLocalAuthScenario(['--scenario=brand-isolation'])).toBe('brand-isolation')
    expect(tools.parseLocalAuthScenario(['--scenario=auth-rate-limit'])).toBe('auth-rate-limit')
    expect(tools.parseLocalAuthScenario(['--scenario=login-rate-limit'])).toBe('login-rate-limit')
    expect(tools.parseLocalAuthScenario(['--scenario=account-unlock-rate-limit'])).toBe('account-unlock-rate-limit')
    for (const args of [['--scenario=production'], ['--scenario='], ['--scenario=brand-isolation', '--scenario=first-value']]) {
      expect(() => tools.parseLocalAuthScenario(args)).toThrow('LOCAL_AUTH_SCENARIO_INVALID')
    }
  })
  it('allows a local synthetic Pro fixture only for its exact run identity and dedicated scenario', () => {
    expect(typeof tools.verifyMultiBrandFixture).toBe('function')
    const config = { ...spec(), mode: tools.evidenceMode, scenario: 'brand-isolation',
      database: spec().database, containerVerified: true, containerId, dbHost: '127.0.0.1' }
    const identity = { id: runId, account_id: 'c1111111-1111-4111-8111-111111111111' }
    const email = `desktop-en-${runId}@fixture-aiso.example`
    expect(tools.verifyMultiBrandFixture(config, identity, email)).toBe(identity.account_id)
    for (const patch of [{ scenario: 'first-value' }, { containerVerified: false }, { mode: 'production' },
      { dbHost: 'shared.example' }, { database: 'shared_db' }, { containerId: 'unknown' }]) {
      expect(() => tools.verifyMultiBrandFixture({ ...config, ...patch }, identity, email)).toThrow('LOCAL_AUTH_MULTI_BRAND_TARGET')
    }
    expect(() => tools.verifyMultiBrandFixture(config, { ...identity, account_id: null }, email)).toThrow('LOCAL_AUTH_MULTI_BRAND_TARGET')
    expect(() => tools.verifyMultiBrandFixture(config, identity, 'real-user@example.com')).toThrow('LOCAL_AUTH_MULTI_BRAND_TARGET')
    expect(() => tools.verifyMultiBrandFixture(config, identity, `desktop-en-foreign-run@fixture-aiso.example`)).toThrow('LOCAL_AUTH_MULTI_BRAND_TARGET')
  })
  it('requires the local Docker named-pipe context before creating or recovering resources', () => {
    expect(typeof tools.verifyLocalDockerContext).toBe('function')
    expect(tools.verifyLocalDockerContext({ Endpoints: { docker: { Host: 'npipe:////./pipe/dockerDesktopLinuxEngine' } } })).toBe(true)
    for (const Host of ['ssh://shared-host', 'tcp://127.0.0.1:2375', 'https://docker.example', '']) {
      expect(() => tools.verifyLocalDockerContext({ Endpoints: { docker: { Host } } })).toThrow('LOCAL_AUTH_DOCKER_MUST_BE_LOCAL')
    }
  })
  it('requires a unique run and an exact immutable image identity', () => {
    expect(typeof tools.runSpec).toBe('function')
    expect(() => tools.runSpec('shared', imageId)).toThrow('LOCAL_AUTH_RUN_ID')
    expect(() => tools.runSpec(runId, 'postgres:16')).toThrow('LOCAL_AUTH_IMAGE_ID')
    expect(spec().database).toBe('aiso_auth_a1111111111141118111111111111111')
  })

  it('accepts only the returned owned container with its exact loopback published port', () => {
    expect(typeof tools.verifyContainer).toBe('function')
    expect(tools.verifyContainer(inspect(), spec(), containerId)).toEqual({ host: '127.0.0.1', port: 55555 })
    for (const mutate of [
      value => { value.Id = 'c'.repeat(64) },
      value => { value.Image = `sha256:${'c'.repeat(64)}` },
      value => { value.Config.Labels['com.aiso.local-auth.run'] = 'another-run' },
      value => { value.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0' },
      value => { value.HostConfig.Binds = ['shared-volume:/var/lib/postgresql/data'] },
    ]) {
      const value = inspect()
      mutate(value)
      expect(() => tools.verifyContainer(value, spec(), containerId)).toThrow('LOCAL_AUTH_CONTAINER_IDENTITY')
    }
  })

  it('requires in-band local binding, current database and exact role before any fixture write', () => {
    expect(typeof tools.verifyDatabase).toBe('function')
    const expected = spec()
    const row = { project_id: expected.projectId, branch_id: expected.branchId, database: expected.database, role: 'aeo_app' }
    expect(tools.verifyDatabase(row, expected, 'aeo_app')).toBe(true)
    for (const field of Object.keys(row)) {
      expect(() => tools.verifyDatabase({ ...row, [field]: 'wrong' }, expected, 'aeo_app')).toThrow('LOCAL_AUTH_DATABASE_IDENTITY')
    }
  })

  it('allows only exact owned loopback origins, without credentials or alternate hosts', () => {
    expect(typeof tools.allowLocalUrl).toBe('function')
    const allowed = ['https://127.0.0.1:44444']
    expect(tools.allowLocalUrl('https://127.0.0.1:44444/api/auth/get-session', allowed)).toBe(true)
    for (const value of ['https://example.com', 'https://localhost:44444', 'https://127.0.0.1:44445', 'https://user:pass@127.0.0.1:44444']) {
      expect(() => tools.allowLocalUrl(value, allowed)).toThrow('LOCAL_AUTH_NETWORK_DENIED')
    }
  })

  it('does not inherit credentials and blanks dotenv keys before Next can reload them', () => {
    expect(typeof tools.localEnvironment).toBe('function')
    const env = tools.localEnvironment({
      Path: 'safe-path', SystemRoot: 'safe-root', DATABASE_URL: 'live-db',
      oPeNrOuTeR_aPi_KeY: 'live-provider', AWS_SECRET_ACCESS_KEY: 'live-aws',
      NODE_OPTIONS: '--require unwanted', HTTPS_PROXY: 'https://shared-gateway',
    }, ['OTHER_SERVICE_TOKEN="live-token"\nFEATURE_PULSE_ATTEMPTS=true'])
    expect(env.Path).toBe('safe-path')
    expect(env.DATABASE_URL).toBe('')
    expect(env.OTHER_SERVICE_TOKEN).toBe('')
    expect(env.FEATURE_PULSE_ATTEMPTS).toBe('false')
    expect(env.E2E_FIXTURE_MODE).toBe('')
    expect(JSON.stringify(env)).not.toMatch(/live-|shared-gateway|unwanted/)
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
  })

  it('redacts ephemeral secrets, DSNs, cookie headers and magic-link query values from evidence', () => {
    expect(typeof tools.redactLocalAuth).toBe('function')
    const input = 'post' + 'gresql://owner:example-secret@127.0.0.1:55555/db\n' +
      'Cookie: __Secure-neon-auth.session_token=secret-cookie\n' +
      'https://127.0.0.1:44444/api/auth/magic-link/verify?token=magic-secret\n' +
      'ephemeral-private-value'
    const output = tools.redactLocalAuth(input, ['ephemeral-private-value'])
    expect(output).not.toMatch(/secret-cookie|magic-secret|ephemeral-private-value|owner:example-secret/)
    expect(output).toContain('REDACTED')
  })

  it('keeps private run files inside the dedicated ignored artifact root', () => {
    expect(typeof tools.artifactDirectory).toBe('function')
    expect(tools.artifactDirectory(process.cwd(), runId)).toBe(resolve('artifacts', 'first-value-flow-20261017', `local-auth-${runId}`))
    expect(() => tools.artifactDirectory(process.cwd(), '../shared')).toThrow('LOCAL_AUTH_RUN_ID')
  })

  it('requires a brand already created by the real owned onboarding path before scan seeding', () => {
    expect(typeof tools.verifyOwnedFixtureBrand).toBe('function')
    const identity = { id: runId, account_id: 'c1111111-1111-4111-8111-111111111111' }
    const brand = { id: 'd1111111-1111-4111-8111-111111111111', account_id: identity.account_id, domain: 'fixture-aiso.example' }
    expect(tools.verifyOwnedFixtureBrand(brand, identity, brand.id)).toBe(brand.id)
    expect(() => tools.verifyOwnedFixtureBrand(null, identity, brand.id)).toThrow('LOCAL_AUTH_EXISTING_OWNED_BRAND_REQUIRED')
    expect(() => tools.verifyOwnedFixtureBrand({ ...brand, account_id: 'foreign' }, identity, brand.id)).toThrow('LOCAL_AUTH_EXISTING_OWNED_BRAND_REQUIRED')
    expect(() => tools.verifyOwnedFixtureBrand(brand, identity, runId)).toThrow('LOCAL_AUTH_EXISTING_OWNED_BRAND_REQUIRED')
  })
})
