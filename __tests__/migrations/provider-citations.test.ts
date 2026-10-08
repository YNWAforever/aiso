import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {it,expect} from 'vitest'

// A local, in-memory Postgres ACL regression. This does not replace the guarded
// Neon integration suite or grant any role on an external database.
it('permits citation evidence updates under the existing runtime role without widening immutable fields',async()=>{
  const pg=await PGlite.create()
  try {
    await pg.exec(`
      create role aeo_app;
      create table accounts(id uuid primary key);
      create table clients(id uuid primary key,account_id uuid references accounts(id),unique(id,account_id));
      create table prompt_bank(id uuid primary key);
      create table pulse_metrics(id uuid primary key,prompt_id uuid constraint pulse_metrics_prompt_id_fkey references prompt_bank(id));
    `)
    await pg.exec(readFileSync('supabase/migrations/057_pulse_run_ledger.sql','utf8'))
    await pg.exec(readFileSync('supabase/migrations/060_provider_citations.sql','utf8'))
    const {rows}=await pg.query<{citations:boolean;reason:boolean;identity:boolean;table_update:boolean}>(`
      select has_column_privilege('aeo_app','public.pulse_item_attempts','provider_citations','UPDATE') as citations,
        has_column_privilege('aeo_app','public.pulse_item_attempts','provider_finish_reason','UPDATE') as reason,
        has_column_privilege('aeo_app','public.pulse_item_attempts','requested_model','UPDATE') as identity,
        has_table_privilege('aeo_app','public.pulse_item_attempts','UPDATE') as table_update
    `)
    expect(rows).toEqual([{citations:true,reason:true,identity:false,table_update:false}])
    await pg.exec('set role aeo_app')
    // PostgreSQL checks column privileges even when there are no matching rows.
    await expect(pg.exec("update pulse_item_attempts set provider_citations='[]'::jsonb,provider_finish_reason='stop'")).resolves.toBeDefined()
    await expect(pg.exec("update pulse_item_attempts set requested_model='forbidden'")).rejects.toMatchObject({code:'42501'})
  } finally { await pg.close() }
})
