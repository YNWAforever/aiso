import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function offlineBuildEnvironment(ambient, dotenvContents = []) {
  const env = { ...ambient }
  const set = (key, value) => {
    const folded = key.toLowerCase()
    // Windows treats environment names case-insensitively. Delete every
    // case-equivalent inherited value before writing the one blank key.
    for (const inherited of Object.keys(env)) {
      if (inherited.toLowerCase() === folded) delete env[inherited]
    }
    env[key] = value
  }
  const blank = key => set(key, '')
  // Defined empty values prevent Next's dotenv loader from restoring live
  // settings. Read variable names only; never log or evaluate their values.
  for (const text of dotenvContents) {
    // Follow the dotenv grammar bundled by @next/env, including colon
    // assignments and multiline quotes. The compatibility test exercises
    // the installed Next parser without reading any real dotenv file.
    const assignments = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(?:\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm
    for (const match of text.replace(/\r\n?/g, '\n').matchAll(assignments)) blank(match[1])
  }
  for (const key of ['DATABASE_URL', 'MIGRATE_DATABASE_URL', 'OPENROUTER_API_KEY',
    'N8N_API_KEY', 'N8N_MCP_TOKEN', 'N8N_SCAN_WEBHOOK_URL', 'RESEND_API_KEY',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CRON_SECRET']) blank(key)
  for (const [key, value] of Object.entries({
    CI: '1', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', FEATURE_PULSE_ATTEMPTS: 'false',
    NEON_AUTH_BASE_URL: 'https://fixture.invalid', NEON_AUTH_COOKIE_SECRET: 'fixture'.repeat(8),
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  })) set(key, value)
  return env
}

export async function assertBuildIpc({ spawnProcess = spawn, timeoutMs = 5000 } = {}) {
  let child, timer, verified = false
  const sockets = new Set()
  const server = createServer(socket => {
    sockets.add(socket)
    let received = ''
    socket.on('data', bytes => {
      received += bytes.toString()
      if (received === 'aiso-build-ipc') { verified = true; socket.end('ok') }
      else if (received.length >= 14) socket.destroy()
    })
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
  })
  try {
    await new Promise((ready, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ready) })
    const script = `const net=require('node:net');let reply='';const socket=net.createConnection({host:'127.0.0.1',port:Number(process.argv[1])});socket.once('connect',()=>socket.write('aiso-build-ipc'));socket.on('data',bytes=>{reply+=bytes;socket.end()});socket.on('error',()=>{process.exitCode=1});socket.once('close',()=>{if(reply!=='ok')process.exitCode=1});`
    await new Promise((ready, fail) => {
      timer = setTimeout(() => { child?.kill(); fail(new Error('BUILD_IPC_UNAVAILABLE')) }, timeoutMs)
      child = spawnProcess(process.execPath, ['-e', script, String(server.address().port)], { stdio: 'ignore' })
      child.once('error', fail)
      child.once('close', code => { if (code === 0 && verified) ready(); else fail(new Error('BUILD_IPC_UNAVAILABLE')) })
    })
    return { connected: true }
  } catch {
    throw new Error('BUILD_IPC_UNAVAILABLE')
  } finally {
    clearTimeout(timer)
    if (child?.exitCode === null && !child.killed) child.kill()
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise(done => server.close(done))
  }
}

export async function runOfflineBuild(root = process.cwd()) {
  await assertBuildIpc()
  const contents = []
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    try { contents.push(readFileSync(join(root, file), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('BUILD_ENV_UNREADABLE') }
  }
  const env = offlineBuildEnvironment(process.env, contents)
  console.log('[offline-build] Local child IPC verified. Building with test-only Auth settings and disabled provider credentials / monitoring.')
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build'], {
      cwd: root, env, stdio: 'inherit',
    })
    child.once('error', () => fail(new Error('BUILD_PROCESS_UNAVAILABLE')))
    child.once('close', code => done(code ?? 1))
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOfflineBuild().then(code => { process.exitCode = code }).catch(error => {
    const code = ['BUILD_IPC_UNAVAILABLE', 'BUILD_ENV_UNREADABLE', 'BUILD_PROCESS_UNAVAILABLE'].includes(error.message)
      ? error.message : 'BUILD_UNAVAILABLE'
    console.error(`[offline-build] ${code}`)
    if (code === 'BUILD_IPC_UNAVAILABLE') {
      console.error('Turbopack needs local child-process IPC and generated build links. Use an approved terminal with those permissions; this command does not elevate or retry.')
    }
    process.exitCode = 1
  })
}
