import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { artifactDirectory, runSpec, verifyContainer, verifyLocalDockerContext, localEnvironment } from './local-auth-safety.mjs'

// Recovery is bounded by an existing private run manifest, exact Docker
// identity and closed service ports. It never searches for or kills processes.
const exec = promisify(execFile)
const runId = process.argv.find(value => value.startsWith('--run-id='))?.slice(9)
const output = artifactDirectory(process.cwd(), runId)
const privateDir = join(output, '.private')
const config = JSON.parse(readFileSync(join(privateDir, 'config.json'), 'utf8'))
const spec = runSpec(runId, config.imageId)
if (config.runId !== runId || config.containerVerified !== true) throw new Error('LOCAL_AUTH_RECOVERY_MANIFEST')
const env = localEnvironment(process.env)
const docker = async args => (await exec('docker', args, { env })).stdout.trim()
const context = await docker(['context', 'show'])
verifyLocalDockerContext(JSON.parse(await docker(['context', 'inspect', context]))[0])
async function closed(origin) {
  const url = new URL(origin)
  if (url.hostname !== '127.0.0.1') throw new Error('LOCAL_AUTH_RECOVERY_ENDPOINT')
  return new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); done(false) })
    socket.once('timeout', () => { socket.destroy(); done(false) })
    socket.once('error', error => { socket.destroy(); done(error.code === 'ECONNREFUSED') })
  })
}
if (!(await closed(config.appOrigin)) || !(await closed(config.authOrigin))) {
  throw new Error('LOCAL_AUTH_SERVICES_NOT_CONFIRMED_CLOSED')
}
const inspect = JSON.parse(await docker(['inspect', config.containerId]))[0]
verifyContainer(inspect, spec, config.containerId)
await docker(['stop', '--time', '5', config.containerId])
const remaining = await docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `id=${config.containerId}`])
if (remaining) throw new Error('LOCAL_AUTH_CONTAINER_CLEANUP_NOT_CONFIRMED')
writeFileSync(join(output, 'INTERRUPTED-AND-RECONCILED.json'), JSON.stringify({
  runId, status: 'interrupted', launcherExitedBeforeFinalReceipt: true,
  servicePortsConfirmedClosed: true, exactLabelledContainerRemoved: true,
  containerId: config.containerId, at: new Date().toISOString(),
}, null, 2))
for (const name of ['config.json', 'container.env', 'local-ca.pem', 'local-key.pem', 'certificate.ps1']) {
  try { unlinkSync(join(privateDir, name)) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
console.log(`[local-auth] Reconciled interrupted run ${runId}; exact owned container removed.`)
