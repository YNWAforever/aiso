-- 106: Studio MCP call audit.
--
-- The internal-only MCP transport (Phase M2) reads a brand's saved records with
-- a signed token rather than a browser session. Every tools/call is recorded
-- here with the identity the token proved, the tool name, and whether the call
-- was allowed, denied or failed — so "what did the agent read" has an answer
-- that does not depend on the caller's own logs.
--
-- Insert-only for the app role: a call record is history, so aeo_app gets no
-- UPDATE and no DELETE. The profile is a frozen uuid with no FK (the identity
-- that acted must survive profile removal, the same rule 042/043 already state
-- for decisions); the account/brand pair keeps its composite tenant FK.
--
-- No prompt text, answer text, arguments or provider output are stored here —
-- `detail` is a bounded outcome code, and `rpc_id` is the client's JSON-RPC id
-- (already a string the caller chose) so one request can be followed end to end.

create table if not exists studio_mcp_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  profile_id uuid not null,
  tool text not null check (char_length(tool) between 1 and 64),
  outcome text not null check (outcome in ('allowed', 'denied', 'failed')),
  detail text check (detail is null or char_length(detail) <= 200),
  rpc_id text check (rpc_id is null or char_length(rpc_id) <= 64),
  created_at timestamptz not null default now(),
  constraint studio_mcp_calls_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade
);

create index if not exists studio_mcp_calls_brand_time_idx
  on studio_mcp_calls (account_id, client_id, created_at desc);

revoke all on public.studio_mcp_calls from public;

do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.studio_mcp_calls from aeo_app;
    -- Append-only history: no UPDATE, no DELETE.
    grant select, insert on public.studio_mcp_calls to aeo_app;
  end if;
end $$;
