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
})
