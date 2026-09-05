import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import {
  assertExpectationConfigured,
  checkBinding,
  readExpectationFromEnv,
} from '@/lib/security/db-binding'
import { redactSecrets } from '@/lib/security/redact-secrets'

type Sql = NeonQueryFunction<false, false>

// Lazy singleton — neon() is deferred until first use so that module
// evaluation at Next.js build time (when env vars may be absent) does not
// throw "No database connection string was provided".
let _guarded: Sql | null = null

/**
 * The binding check, memoized as a PROMISE rather than as its result, so two
 * concurrent first queries await one check instead of issuing two. Never
 * cleared: a process that has proved its binding once cannot be repointed
 * without restarting, and re-proving it per query would double every round trip.
 */
let _verified: Promise<void> | null = null

/** Endpoint host only. The full DSN carries the password and must never travel. */
function hostOf(dsn: string): string {
  try {
    return new URL(dsn).hostname
  } catch {
    return 'unknown'
  }
}

/**
 * Asks the connection who it is, in band, on a session of the same pool that
 * will run everything else — the shape __tests__/integration/setup.ts has used
 * since it was written. Neon exposes neon.project_id and neon.branch_id as
 * GUCs; an absent GUC reads as null and compares unequal, so this fails closed.
 *
 * Throws on a mismatch, and throws if the identity query itself rejects. There
 * is no catch-and-continue and no opt-out flag: the incident this exists for
 * (see lib/security/db-binding.ts) was a wrong binding that nothing noticed for
 * three days, and a flag would simply be the thing that was set wrong next.
 */
async function verifyBinding(raw: Sql): Promise<void> {
  const expected = readExpectationFromEnv()
  // Before the connection, not after: with no expectation configured there is
  // nothing an identity query could establish.
  assertExpectationConfigured(expected)

  let rows: Record<string, unknown>[]
  try {
    rows = await raw`
      select current_setting('neon.project_id', true) as project_id,
             current_setting('neon.branch_id', true)  as branch_id,
             current_user                             as role,
             current_database()                       as database
    `
  } catch (err) {
    // Rethrown, never swallowed — a guard that could not ask still fails
    // closed. Redacted because this is the one query whose failure is reported
    // by the driver, and the driver puts the connection URL, password included,
    // into its own error text (see CLAUDE.md, Secrets Hygiene). `cause` keeps
    // the original for a debugger without putting it in the message.
    throw new Error(
      `Refusing to query the database — the connection could not be identified: ` +
      redactSecrets(err instanceof Error ? err.message : String(err)),
      { cause: err },
    )
  }
  const row = rows[0] ?? {}
  const verdict = checkBinding(
    {
      projectId: (row.project_id as string | null) ?? null,
      branchId: (row.branch_id as string | null) ?? null,
      role: String(row.role ?? ''),
      database: String(row.database ?? ''),
      host: hostOf(process.env.DATABASE_URL ?? ''),
    },
    expected,
  )
  if (!verdict.ok) {
    throw new Error(`Refusing to query the database — ${verdict.reason}`)
  }
}

function verified(raw: Sql): Promise<void> {
  _verified ??= verifyBinding(raw)
  return _verified
}

/**
 * Defers a lazy NeonQueryPromise until the binding is proved.
 *
 * It must stay a NeonQueryPromise and not become a plain Promise: the driver's
 * `transaction()` rejects anything failing `instanceof NeonQueryPromise`, and
 * composed queries are recognised the same way. A Proxy keeps `instanceof`,
 * `queryData` and `opts` intact while only the three settle methods — which are
 * the only path to actually sending the query — wait for the check.
 */
function deferUntilVerified<T extends object>(raw: Sql, query: T): T {
  const settled = () =>
    // `.then(() => query)` adopts the thenable, which is what triggers the real
    // send. It reads `.then` off the raw query object, not off this proxy, so
    // there is no recursion.
    verified(raw).then(() => query as unknown as PromiseLike<unknown>)

  return new Proxy(query, {
    get(target, prop, receiver) {
      if (prop === 'then') {
        return (onFulfilled?: never, onRejected?: never) => settled().then(onFulfilled, onRejected)
      }
      if (prop === 'catch') {
        return (onRejected?: never) => settled().catch(onRejected)
      }
      if (prop === 'finally') {
        return (onFinally?: never) => settled().finally(onFinally)
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * The Neon SQL client, guarded.
 *
 * The signature is unchanged and synchronous — 43 modules import this — but the
 * first query made through the returned function proves, against the database
 * itself, that it is the database this process was configured to reach. See
 * lib/security/db-binding.ts for the incident that made this a runtime check
 * rather than a test.
 */
export function db(): NeonQueryFunction<false, false> {
  if (!_guarded) {
    const raw = neon<false, false>(process.env.DATABASE_URL!)
    _guarded = new Proxy(raw, {
      // Tagged-template calls: forward strings and values unchanged, then defer
      // the result until the binding is proved.
      apply(target, thisArg, args: Parameters<Sql>) {
        return deferUntilVerified(raw, Reflect.apply(target, thisArg, args) as object)
      },
      // Everything else on NeonQueryFunction is forwarded rather than
      // re-declared, so a driver upgrade that adds a property needs no change
      // here. Two members are wrapped because they reach the database by their
      // own route and would otherwise be an unguarded first query:
      //
      //   transaction() builds its batch from each query's `queryData` without
      //     ever settling them, so deferUntilVerified above never fires.
      //   query() is the parameterized entry point; its result is deferred the
      //     same way a tagged template's is.
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function') return value
        if (prop === 'transaction') {
          return (...args: unknown[]) =>
            verified(raw).then(() => (value as (...a: unknown[]) => unknown).apply(target, args))
        }
        if (prop === 'query') {
          return (...args: unknown[]) =>
            deferUntilVerified(raw, (value as (...a: unknown[]) => object).apply(target, args))
        }
        return value.bind(target)
      },
    }) as Sql
  }
  return _guarded
}
