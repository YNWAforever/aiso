import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts as Record<string, string>

describe('worker operator commands', () => {
  it.each(['dev', 'deploy', 'tail'])('%s selects the intended AISO target and only approved schedules', command => {
    const dir = mkdtempSync(join(tmpdir(), 'aiso-worker-command-'))
    try {
      mkdirSync(join(dir, 'bin'))
      // Exercise each actual package script with a harmless CLI double, never
      // a deployment or tail connection. Defaults resolve the legacy config,
      // reproducing the dangerous target selection when --config is omitted.
      writeFileSync(join(dir, 'bin', 'wrangler'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), index = args.indexOf('--config');
const file = path.resolve(index < 0 ? 'wrangler.jsonc' : args[index + 1]);
const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\\s*\\/\\/.*$/gm, ''));
console.log(JSON.stringify({command: args[0], file, name: config.name, origin: config.vars.APP_BASE_URL, crons: config.triggers.crons}));
`, { mode: 0o700 })
      const result = spawnSync(scripts[command], {
        shell: true, cwd: root, encoding: 'utf8', timeout: 5000,
        env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
      })
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        command, file: resolve(root, '../aiso-worker/wrangler.jsonc'),
        name: 'aiso-cron-worker', origin: 'https://aiso-kappa.vercel.app',
        crons: ['17 4 * * *', '47 7 * * 1'],
      })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
