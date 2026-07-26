import { describe, it, expect } from 'vitest'
import { planMigrations, assertNoTransactionControl } from '@/scripts/migrate'

describe('planMigrations', () => {
  const all = ['001_a.sql', '007_b.sql', '027_c.sql', '028_d.sql']

  it('returns every file when the ledger is empty', () => {
    expect(planMigrations(all, [])).toEqual(all)
  })

  it('returns only files absent from the ledger, in filename order', () => {
    expect(planMigrations(all, ['001_a.sql', '028_d.sql'])).toEqual(['007_b.sql', '027_c.sql'])
  })

  it('sorts by filename regardless of input order', () => {
    expect(planMigrations(['028_d.sql', '001_a.sql'], [])).toEqual(['001_a.sql', '028_d.sql'])
  })

  it('ignores ledger entries with no matching file', () => {
    expect(planMigrations(['001_a.sql'], ['001_a.sql', '999_gone.sql'])).toEqual([])
  })
})

describe('assertNoTransactionControl', () => {
  it('accepts a migration with a dollar-quoted function body', () => {
    const sql = `create or replace function f() returns int as $$ begin return 1; end; $$ language plpgsql;`
    expect(() => assertNoTransactionControl('x.sql', sql)).not.toThrow()
  })

  it('rejects a migration that opens its own transaction', () => {
    expect(() => assertNoTransactionControl('x.sql', 'begin;\ncreate table t();')).toThrow(/transaction control/i)
  })

  it('rejects a migration that commits', () => {
    expect(() => assertNoTransactionControl('x.sql', 'create table t();\ncommit;')).toThrow(/transaction control/i)
  })

  it('does not mistake a column named begin_at for transaction control', () => {
    expect(() => assertNoTransactionControl('x.sql', 'create table t(begin_at timestamptz);')).not.toThrow()
  })

  it('accepts a named dollar-quote tag (not just $$) whose body contains a bare begin;', () => {
    const sql = `create or replace function f() returns trigger as $function$
      begin;
      return new;
      end;
    $function$ language plpgsql;`
    expect(() => assertNoTransactionControl('x.sql', sql)).not.toThrow()
  })

  it('still catches a real commit; sitting between two same-tagged dollar-quoted blocks', () => {
    // Verifies the lazy match closes each $acl$ span at its *nearest* matching
    // delimiter rather than overshooting to the second block's closing tag,
    // which would otherwise also swallow (and hide) the commit; in between.
    const sql = `do $acl$ null; end $acl$;
    commit;
    do $acl$ null; end $acl$;`
    expect(() => assertNoTransactionControl('x.sql', sql)).toThrow(/transaction control/i)
  })

  it('rejects a bare begin; even when a line comment sits directly above it', () => {
    const sql = 'create table t();\n-- start a block\nbegin;\ncreate table u();'
    expect(() => assertNoTransactionControl('x.sql', sql)).toThrow(/transaction control/i)
  })

  it('rejects a bare commit; even when a block comment sits directly above it', () => {
    const sql = 'create table t();\n/* wrap up */\ncommit;'
    expect(() => assertNoTransactionControl('x.sql', sql)).toThrow(/transaction control/i)
  })
})
