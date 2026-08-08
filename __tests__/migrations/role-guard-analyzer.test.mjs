import { describe, expect, it } from 'vitest'

import { findUnguardedRoleStatements } from '../helpers/migration-role-guards.mjs'

describe('migration role guard analyzer', () => {
  it('accepts role ACLs nested in the matching to_regrole guard', () => {
    const sql = `
      do $acl$
      begin
        if to_regrole('anon') is not null then
          execute 'revoke all on example from anon';
        end if;
      end
      $acl$;
    `

    expect(findUnguardedRoleStatements(sql)).toEqual([])
  })

  it('rejects dynamic role ACLs without the matching guard', () => {
    const sql = `
      do $acl$
      begin
        execute 'revoke all on example from anon';
      end
      $acl$;
    `

    expect(findUnguardedRoleStatements(sql)).toEqual([
      expect.objectContaining({ role: 'anon' }),
    ])
  })
})
