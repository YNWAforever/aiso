import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AC-14's manual gate, pinned so it cannot rot into a lie.
 *
 * The authenticated owner journey **cannot** run in CI. This product has no
 * password sign-in — only magic link and Google OAuth — so no credential exists
 * for a runner to present, and no amount of configuration changes that. A session
 * is captured once by a human and replayed from a gitignored file.
 *
 * That makes it a manual gate, and the danger with a manual gate is that it
 * quietly becomes decoration: the capture script rots, the fixture goes back to
 * yielding an anonymous page, or the specs drift into a project that has no
 * session and get "fixed" by softening them. These assertions are the part that
 * notices.
 *
 * `playwright-config.test.ts` covers the CI launcher and the client-report gate;
 * `playwright-projects.test.ts` covers discovery counts. Neither knows this gate
 * exists, and nothing here restates them.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

/**
 * Source with comments stripped. Several assertions below forbid a construct, and
 * both files under test explain in prose exactly which construct they forbid — as
 * they should, since a rule nobody can read is a rule nobody keeps. Matching the
 * raw text would fail on the explanation rather than on the behaviour.
 */
const code = (path: string) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const config = read('playwright.config.ts')
const fixture = read('tests/fixtures/auth.ts')
const fixtureCode = code('tests/fixtures/auth.ts')
const capture = read('scripts/e2e/capture-auth-state.mjs')
const captureCode = code('scripts/e2e/capture-auth-state.mjs')
const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>

describe('the authenticated project is gated on a real captured session', () => {
  it('appears only when the state file exists, not merely when a variable is set', () => {
    // A path pointing at nothing makes Playwright fail with a file error naming
    // no test, which reads as a broken suite rather than an unconfigured one.
    expect(config).toContain('existsSync(resolve(process.cwd(), authStatePath))')
    expect(config).toContain('authenticatedConfigured')
  })

  it('keeps authenticated specs out of every project that has no session', () => {
    // chromium, mobile and the four a11y projects carry no cookies. An
    // authenticated spec under them fails for want of a session, and a failure
    // like that teaches nothing about the page it names — so it gets softened.
    const baseIgnore = config.slice(config.indexOf('const testIgnore = ['), config.indexOf('export default'))

    expect(baseIgnore).toContain("'tests/e2e/authenticated/**'")
  })

  it('runs the journey on a phone, which is what AC-14 asks about', () => {
    expect(config).toContain("name: 'authenticated-mobile'")
    expect(config).toContain("devices['Pixel 5'], storageState: authStatePath")
  })
})

describe('the fixture refuses rather than pretends', () => {
  it('never hands back an anonymous page', () => {
    // The original fixture filled a password field that has never existed and,
    // when the password was empty — always — yielded a plain anonymous page
    // named `authenticatedPage`. A test using it ran logged out while reading as
    // logged in.
    expect(fixtureCode).not.toMatch(/input\[type="password"\]/)
    expect(fixtureCode).not.toMatch(/PLAYWRIGHT_TEST_PASSWORD/)
    expect(fixture).toContain('throw new Error(REASON)')
  })

  it('proves the session before yielding, so a stale capture is not read as a product failure', () => {
    expect(fixture).toContain("page.goto('/en/dashboard')")
    expect(fixture).toContain('toHaveURL')
  })

  it('names the command that fixes an absent session', () => {
    expect(fixture).toContain('npm run e2e:auth:capture')
    expect(fixture).toContain('NEON_AUTH_BASE_URL')
  })
})

describe('the capture script authenticates nobody', () => {
  it('opens a browser for a human rather than typing a credential', () => {
    // The boundary that matters. Capturing a session a human established is
    // fine; entering someone's credentials for them is not, and this repo should
    // not contain a tool that does.
    expect(capture).toContain('headless: false')
    expect(captureCode).not.toMatch(/\.fill\(/)
    expect(captureCode).not.toMatch(/PLAYWRIGHT_TEST_PASSWORD/)
  })

  it('refuses before opening a browser when a session could not exist anyway', () => {
    // Without NEON_AUTH_BASE_URL every authenticated route answers 503, so
    // anything captured would be an anonymous state file wearing an
    // authenticated name.
    expect(capture).toContain('requireConfigured()')
    expect(capture).toContain('NEON_AUTH_BASE_URL')
  })

  it('refuses to write an empty session', () => {
    expect(capture).toContain('refusing to write an empty session')
  })
})

describe('the gate is reachable and the session is not committable', () => {
  it('is one command each to capture and to run', () => {
    expect(scripts['e2e:auth:capture']).toContain('scripts/e2e/capture-auth-state.mjs')
    expect(scripts['e2e:authenticated']).toContain('scripts/e2e/run-authenticated.mjs')
    // The runner is what turns Playwright's generic "project not found" into an
    // instruction. It must still target the project, and must never exit 0 when
    // it cannot run.
    expect(read('scripts/e2e/run-authenticated.mjs')).toContain('--project=authenticated-mobile')
    expect(read('scripts/e2e/run-authenticated.mjs')).toContain('process.exit(1)')
  })

  it('keeps the captured session out of git', () => {
    // It is a live session. Committing it would be committing a password.
    expect(read('.gitignore')).toMatch(/^\.auth\/$/m)
  })
})
