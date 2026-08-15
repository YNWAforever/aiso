import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** Every `on conflict (a, b, c)` target written in application SQL. */
function conflictTargets(source: string): string[][] {
  return [...source.matchAll(/on\s+conflict\s*\(([^)]+)\)/gi)].map(match =>
    match[1].split(',').map(column => column.trim()).filter(Boolean),
  )
}

/**
 * Every unique arbiter the migration set creates, as its column list.
 *
 * This accumulates every CREATE UNIQUE INDEX / UNIQUE (...) / PRIMARY KEY it finds
 * across every migration file and never models DROP INDEX or migration ordering --
 * once a column set has been seen here, nothing removes it, even if a later
 * migration drops that exact index. So an index some later file drops still reads
 * as a live arbiter.
 *
 * Not hypothetical: `notifications_dedup_idx` was first created *partial* in
 * 011_phase3b_hardening.sql (`WHERE client_id IS NOT NULL AND scan_week IS NOT
 * NULL`), which a bare `ON CONFLICT (client_id, type, scan_week)` cannot use as an
 * arbiter -- Postgres only infers a partial index when the statement's own WHERE
 * clause matches it, and neon-store.ts's writes carry none. Only
 * 033_alert_evaluation_hardening.sql drops that index and recreates it non-partial.
 * For the window between those two migrations, this function would have reported a
 * match that could not actually serve as an arbiter -- the exact 42P10 shape this
 * guard exists to catch, missed. It reads correctly today only because 033 also
 * supplies a full index over the same columns; nothing here would notice if that
 * coincidence stopped holding.
 *
 * Arbiters are also pooled across every table, not scoped to the one the
 * statement targets: `sameColumns` compares column sets only, so a target
 * passes if ANY table anywhere has that column set. Live example: `(client_id,
 * type, scan_week)` matches both `notifications` (033) and
 * `alert_email_deliveries` (035) -- a future writer aimed at the wrong table
 * would pass this guard silently. Not fixed here; recorded so it is not
 * mistaken for coverage it does not provide.
 */
function uniqueIndexes(): string[][] {
  const dir = join(process.cwd(), 'supabase/migrations')
  const out: string[][] = []
  const columns = (list: string) =>
    list.split(',').map(c => c.trim().replace(/\s+(asc|desc).*$/i, '')).filter(Boolean)

  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, file), 'utf8')

    for (const match of sql.matchAll(/create\s+unique\s+index[^(]*\(([^)]+)\)/gi)) {
      out.push(columns(match[1]))
    }
    // Table-level UNIQUE (a, b) constraints are arbiters too.
    for (const match of sql.matchAll(/\bunique\s*\(([^)]+)\)/gi)) {
      out.push(columns(match[1]))
    }
    // So is a PRIMARY KEY -- it creates an implicit unique index. Both spellings
    // occur in this repo: table-level `primary key (a, b)` (023, 025) and the
    // column-level `account_id uuid primary key` (027).
    for (const match of sql.matchAll(/\bprimary\s+key\s*\(([^)]+)\)/gi)) {
      out.push(columns(match[1]))
    }
    for (const match of sql.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[^,(]*?\bprimary\s+key\b/gim)) {
      out.push([match[1]])
    }
  }

  return out
}

function sameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}

describe('ON CONFLICT arbiters exist', () => {
  it('the weekly summary writer has a matching unique index', () => {
    // The concrete failure this pins: pulse_weekly_summary carried no uniqueness
    // from 002 until 031, so computeWeeklySummary's ON CONFLICT would raise
    // 42P10 on every execution. A mocked-sql unit test cannot see that, because
    // the arbiter is resolved by Postgres at execution time, not by the driver.
    const summary = readFileSync(join(process.cwd(), 'lib/pulse/summary.ts'), 'utf8')
    const targets = conflictTargets(summary)

    expect(targets.length, 'expected computeWeeklySummary to use ON CONFLICT').toBeGreaterThan(0)

    const indexes = uniqueIndexes()
    for (const target of targets) {
      expect(
        indexes.some(index => sameColumns(index, target)),
        `no unique arbiter matches ON CONFLICT (${target.join(', ')})`,
      ).toBe(true)
    }
  })

  it('every ON CONFLICT under lib/, app/ and scripts/ has a matching unique index', () => {
    const dirs = ['lib', 'app', 'scripts'].map(name => join(process.cwd(), name))
    const indexes = uniqueIndexes()
    const files: string[] = []

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.ts')) files.push(path)
      }
    }
    dirs.forEach(walk)

    for (const file of files) {
      for (const target of conflictTargets(readFileSync(file, 'utf8'))) {
        expect(
          indexes.some(index => sameColumns(index, target)),
          `${file}: no unique arbiter matches ON CONFLICT (${target.join(', ')})`,
        ).toBe(true)
      }
    }
  })
})
