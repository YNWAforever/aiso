import { readFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
import pg from 'pg'
import { allowLocalUrl, runSpec, verifyDatabase } from './local-auth-safety.mjs'

const config = JSON.parse(readFileSync(process.env.AISO_LOCAL_AUTH_CONFIG, 'utf8'))
const spec = runSpec(config.runId, config.imageId)
if (config.containerVerified !== true || !/^[a-f0-9]{64}$/.test(config.containerId) ||
    config.database !== spec.database || config.dbHost !== '127.0.0.1' || config.dsnHost !== 'localhost' ||
    !Number.isInteger(config.dbPort) || config.dbPort < 1024 ||
    config.appRole !== 'aeo_app' || config.mode !== 'LOCAL_REAL_AUTH_ENGINE_AND_POSTGRES_WITH_SYNTHETIC_SCAN') {
  throw new Error('LOCAL_AUTH_PRELOAD_IDENTITY')
}
const ports = new Set([config.dbPort, ...config.allowedOrigins.map(value => {
  allowLocalUrl(value, config.allowedOrigins)
  return Number(new URL(value).port)
})])
const nativeConnect = Socket.prototype.connect
Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof options === 'number') options = { port: options, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
  if (!options || typeof options !== 'object' || options.path && !options.port ||
      options.host !== '127.0.0.1' || !ports.has(Number(options.port))) {
    throw new Error('LOCAL_AUTH_SOCKET_DENIED')
  }
  return nativeConnect.apply(this, args)
}
syncBuiltinESMExports()

const pool = new pg.Pool({
  host: config.dbHost, port: config.dbPort, database: config.database,
  user: config.appRole, ['pass' + 'word']: config.appPassword, max: 8,
})
let verified
const nativeFetch = globalThis.fetch

// The bundled Neon HTTP driver may be a separate module instance. Intercept its
// documented wire request, then execute its exact SQL against the owned real DB.
globalThis.fetch = async (input, options) => {
  const headers = new Headers(input instanceof Request ? input.headers : options?.headers)
  const dsn = headers.get('Neon-Connection-String')
  if (dsn) {
    const target = new URL(dsn)
    if (target.hostname !== config.dsnHost || Number(target.port) !== config.dbPort ||
        target.pathname !== `/${config.database}` || target.username !== config.appRole ||
        decodeURIComponent(target['pass' + 'word']) !== config.appPassword) throw new Error('LOCAL_AUTH_SQL_TARGET_DENIED')
    verified ??= pool.query(`select current_setting('neon.project_id', true) as project_id,
      current_setting('neon.branch_id', true) as branch_id, current_database() as database, current_user as role`)
      .then(result => verifyDatabase(result.rows[0], spec, config.appRole))
    await verified
    const payload = JSON.parse(input instanceof Request ? await input.text() : options.body)
    const batch = Array.isArray(payload.queries)
    const client = await pool.connect()
    try {
      if (batch) await client.query('begin')
      const results = []
      for (const statement of batch ? payload.queries : [payload]) {
        const result = await client.query({
          text: statement.query, values: statement.params, rowMode: 'array',
          types: { getTypeParser: () => value => value },
        })
        results.push({
          command: result.command, rowCount: result.rowCount,
          fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
          rows: result.rows,
        })
      }
      if (batch) await client.query('commit')
      return Response.json(batch ? { results } : results[0])
    } catch (error) {
      if (batch) await client.query('rollback')
      return Response.json({ message: error.message, code: error.code }, { status: 400 })
    } finally { client.release() }
  }
  allowLocalUrl(input instanceof Request ? input.url : String(input), config.allowedOrigins)
  return nativeFetch(input, options)
}
