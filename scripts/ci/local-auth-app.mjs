import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import next from 'next'

const config = JSON.parse(readFileSync(process.env.AISO_LOCAL_AUTH_CONFIG, 'utf8'))
if (config.containerVerified !== true || process.env.E2E_FIXTURE_MODE ||
    process.env.FEATURE_PULSE_ATTEMPTS !== 'false' || process.env.OPENROUTER_API_KEY ||
    process.env.RESEND_API_KEY || process.env.CRON_SECRET || process.env.N8N_SCAN_WEBHOOK_URL) {
  throw new Error('LOCAL_AUTH_APP_ENVIRONMENT')
}
const appPort = Number(new URL(config.appOrigin).port)
const server = createServer({
  key: readFileSync(config.keyPath), cert: readFileSync(config.certPath),
})
const app = next({ dev: false, hostname: '127.0.0.1', port: appPort, httpServer: server })
await app.prepare()
const handle = app.getRequestHandler()
server.on('request', (request, response) => {
  request.headers['x-forwarded-proto'] = 'https'
  request.headers['x-forwarded-host'] = request.headers.host
  void handle(request, response)
})
await new Promise((ready, fail) => {
  server.once('error', fail)
  server.listen(appPort, '127.0.0.1', ready)
})
console.log('LOCAL_AUTH_APP_READY')

async function stop() {
  server.closeAllConnections()
  await new Promise(done => server.close(done))
  await app.close()
  process.exit(0)
}
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })
