import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { assertBuildIpc } from './build-offline.mjs'
import { allowLocalUrl, evidenceMode, localEnvironment, runSpec } from './local-auth-safety.mjs'

export function localReportBuildEnvironment(ambient, dotenv, config) {
  try {
    const spec = runSpec(config.runId, config.imageId)
    const origin = new URL(config.appOrigin)
    allowLocalUrl(config.appOrigin, config.allowedOrigins)
    if (config.mode !== evidenceMode || config.scenario !== 'report-recovery' ||
      !config.containerVerified || !/^[a-f0-9]{64}$/.test(config.containerId ?? '') ||
      config.dbHost !== '127.0.0.1' || config.database !== spec.database ||
      origin.protocol !== 'https:' || origin.origin !== config.appOrigin ||
      !Number.isInteger(Number(origin.port)) || Number(origin.port) < 1024 || Number(origin.port) > 65535) {
      throw new Error('Invalid local build')
    }
  } catch { throw new Error('LOCAL_AUTH_BUILD_TARGET') }
  const env = localEnvironment(ambient, dotenv)
  env.NODE_ENV = 'production'
  env.CI = '1'
  env.REPORT_SHARE_SECRET = ''
  // Only the public loopback origin differs from build:offline. No DB/Auth
  // connection or runtime signing secret enters this compilation process.
  env.NEXT_PUBLIC_APP_URL = config.appOrigin
  return env
}

export async function buildLocalReportRuntime(root, config, ambient, dotenv, onData, {
  verifyIpc = assertBuildIpc, spawnProcess = spawn,
} = {}) {
  const env = localReportBuildEnvironment(ambient, dotenv, config)
  const ipc = await verifyIpc()
  if (ipc?.connected !== true) throw new Error('BUILD_IPC_UNAVAILABLE')
  const exitCode = await new Promise((done, fail) => {
    const child = spawnProcess(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build'],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', onData); child.stderr.on('data', onData)
    child.once('error', fail)
    child.once('close', code => done(code ?? 1))
  })
  return { exitCode, ipcVerified: true, publicOrigin: config.appOrigin,
    credentialsCleared: env.DATABASE_URL === '' && env.OPENROUTER_API_KEY === '' && env.REPORT_SHARE_SECRET === '',
    monitoringDisabled: env.FEATURE_PULSE_ATTEMPTS === 'false', preloadDisabled: env.NODE_OPTIONS === '' }
}
