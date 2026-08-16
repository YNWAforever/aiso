-- 037: introduce aeo_app, the least-privilege application role.
--
-- The app has connected as neondb_owner, which is rolbypassrls = true,
-- rolcreaterole = true, and owns every object in public. A leaked application
-- credential therefore IS the database: it can drop any table, alter any
-- schema, and create new roles. aeo_app can read and write application data --
-- which the app does anyway -- but nothing else.
--
-- BYPASSRLS is DELIBERATE and must stay. Seven tables in public have RLS
-- enabled with zero policies; 023, 024, 025 and 027 each chose that
-- default-deny posture for the tables it created. A NOBYPASSRLS role granted
-- SELECT on those returns ZERO ROWS SILENTLY -- precisely the failure migration
-- 036 existed to remove. Verified on a disposable branch 2026-08-16: a freshly
-- created role defaults to rolbypassrls = false, so omitting the keyword
-- reintroduces that failure quietly. This is a grants change, not an RLS
-- change.
--
-- The role is created NOLOGIN. A human sets the password out of band so it
-- never enters git:
--     alter role aeo_app login password '<generated>';
--
-- The neon_auth grants are required, not optional:
--   * app/api/webhooks/neon/route.ts authenticates every payload against
--     neon_auth."user", and @neondatabase/auth ships no webhook signing, so
--     that lookup is the ONLY authentication that endpoint has;
--   * lib/alerts/neon-store.ts joins it to resolve recipient emails.
-- neondb_owner may issue them: it is a member of the neon_auth role that owns
-- the schema. Verified 2026-08-16.

do $$
begin
  if to_regrole('aeo_app') is null then
    create role aeo_app nologin bypassrls;
  else
    alter role aeo_app nologin bypassrls;
  end if;
end $$;

grant usage on schema public to aeo_app;
grant select, insert, update, delete on all tables in schema public to aeo_app;
grant usage, select on all sequences in schema public to aeo_app;

-- Without this, migration 038 creates a table aeo_app cannot read, and the
-- failure surfaces at runtime in whichever route touches it first -- long after
-- the migration looked successful. Applies to objects created by the role
-- running migrations, which is neondb_owner.
alter default privileges in schema public
  grant select, insert, update, delete on tables to aeo_app;
alter default privileges in schema public
  grant usage, select on sequences to aeo_app;

grant usage on schema neon_auth to aeo_app;
grant select on neon_auth."user" to aeo_app;

-- Fail closed. If BYPASSRLS did not take, the seven default-deny tables would
-- return zero rows for every app query, silently. The runner wraps each
-- migration in a transaction, so raising here rolls the whole file back and
-- leaves the ledger unmarked.
do $$
declare
  bypasses boolean;
begin
  select rolbypassrls into bypasses from pg_roles where rolname = 'aeo_app';

  if bypasses is distinct from true then
    raise exception
      'aeo_app must have BYPASSRLS: without it the seven RLS-enabled, zero-policy '
      'tables silently return no rows to the application';
  end if;
end $$;
