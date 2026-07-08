import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

// Lazy singleton — neon() is deferred until first use so that module
// evaluation at Next.js build time (when env vars may be absent) does not
// throw "No database connection string was provided".
let _sql: NeonQueryFunction<false, false> | null = null

export function db(): NeonQueryFunction<false, false> {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!)
  }
  return _sql
}
