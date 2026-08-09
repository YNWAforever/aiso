const { cpSync, mkdirSync, rmSync } = require('node:fs')
const { basename, resolve } = require('node:path')
const { spawn } = require('node:child_process')

const repositoryRoot = resolve(__dirname, '..')
const isolatedRoot = resolve(repositoryRoot, '.playwright-ci-server')
const excludedDirectories = new Set([
  '.codebase-memory',
  '.git',
  '.next',
  '.playwright-ci-server',
  'node_modules',
  'playwright-report',
  'test-results',
])

rmSync(isolatedRoot, { force: true, recursive: true })
mkdirSync(isolatedRoot, { recursive: true })

cpSync(repositoryRoot, isolatedRoot, {
  filter(source) {
    const entry = basename(source)
    return !excludedDirectories.has(entry) && entry !== '.env.local' && !entry.endsWith('.local')
  },
  recursive: true,
})

const nextBinary = require.resolve('next/dist/bin/next')
const server = spawn(
  process.execPath,
  [nextBinary, 'dev', isolatedRoot, '--hostname', '127.0.0.1'],
  { cwd: isolatedRoot, env: process.env, stdio: 'inherit' },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal))
}

server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
