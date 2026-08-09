const { cpSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const { basename, resolve } = require('node:path')
const { spawn } = require('node:child_process')

const excludedDirectories = new Set([
  '.codebase-memory',
  '.git',
  '.next',
  '.playwright-ci-server',
  'node_modules',
  'playwright-report',
  'test-results',
])

function shouldCopyEntry(source) {
  const entry = basename(source)
  return !excludedDirectories.has(entry) && !entry.endsWith('.local')
}

function createIsolatedWorkspace(repositoryRoot, isolatedRoot) {
  rmSync(isolatedRoot, { force: true, recursive: true })
  mkdirSync(isolatedRoot, { recursive: true })

  for (const entry of readdirSync(repositoryRoot)) {
    if (!shouldCopyEntry(entry)) continue

    cpSync(resolve(repositoryRoot, entry), resolve(isolatedRoot, entry), {
      filter: shouldCopyEntry,
      recursive: true,
    })
  }
}

function removeIsolatedWorkspace(isolatedRoot) {
  try {
    rmSync(isolatedRoot, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 })
  } catch (error) {
    console.error('Unable to remove isolated Playwright CI workspace.', error)
  }
}

function run() {
  const repositoryRoot = resolve(__dirname, '..')
  const isolatedRoot = resolve(repositoryRoot, '.playwright-ci-server')
  let finished = false
  let shutdownRequested = false
  let shutdownTimer

  const finish = (code) => {
    if (finished) return
    finished = true
    if (shutdownTimer) clearTimeout(shutdownTimer)
    removeIsolatedWorkspace(isolatedRoot)
    process.exit(code)
  }

  let server
  try {
    createIsolatedWorkspace(repositoryRoot, isolatedRoot)
    const nextBinary = require.resolve('next/dist/bin/next')
    server = spawn(
      process.execPath,
      [nextBinary, 'dev', isolatedRoot, '--hostname', '127.0.0.1'],
      { cwd: isolatedRoot, env: process.env, stdio: 'inherit' },
    )
  } catch (error) {
    console.error('Unable to start isolated Playwright CI server.', error)
    finish(1)
    return
  }

  const requestShutdown = (signal) => {
    if (shutdownRequested || finished) return
    shutdownRequested = true

    try {
      if (!server.kill(signal)) {
        finish(1)
        return
      }

      shutdownTimer = setTimeout(() => {
        try {
          server.kill('SIGKILL')
        } catch {
          finish(1)
        }
      }, 10_000)
    } catch {
      finish(1)
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => requestShutdown(signal))
  }

  server.once('error', (error) => {
    console.error('Unable to start Playwright CI server.', error)
    finish(1)
  })

  server.once('close', (code) => finish(code ?? 1))
}

module.exports = { createIsolatedWorkspace }

if (require.main === module) run()
