import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'

export default class LocalAuthReporter {
  constructor() {
    this.config = JSON.parse(readFileSync(process.env.AISO_LOCAL_AUTH_CONFIG, 'utf8'))
    this.results = []
  }
  clean(value) {
    const cfg = this.config
    return redactLocalAuth(value, [cfg.ownerPassword, cfg.appPassword, cfg.authPassword,
      cfg.engineSecret, cfg.cookieSecret, cfg.controlSecret])
  }
  onTestEnd(test, result) {
    const row = { title: test.titlePath().join(' / '), status: result.status,
      durationMs: result.duration, errors: result.errors.map(error => this.clean(error.message ?? 'Browser test error')) }
    this.results.push(row)
    console.log(this.clean(`[local-real-auth] ${row.status}: ${row.title}`))
  }
  onError(error) {
    this.results.push({ title: 'runner error', status: 'failed', errors: [this.clean(error.message)] })
  }
  onEnd(result) {
    const value = { mode: evidenceMode, managedNeonAuthVerified: false, externalCollectionVerified: false,
      status: result.status, results: this.results }
    writeFileSync(join(this.config.output, 'BROWSER-RESULTS.json'), this.clean(JSON.stringify(value, null, 2)))
  }
}
