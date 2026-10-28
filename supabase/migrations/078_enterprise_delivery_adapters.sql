create table public.enterprise_adapters (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,created_by uuid not null,
 name text not null check(char_length(name) between 1 and 100),model text not null check(char_length(model) between 1 and 200),
 temperature numeric check(temperature between 0 and 2),version text not null default 'connector.v1' check(version='connector.v1'),
 created_at timestamptz not null default clock_timestamp(),revoked_at timestamptz,unique(id,account_id,client_id),
 foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade,foreign key(created_by,account_id) references public.profiles(id,account_id)
);
alter table public.enterprise_keys add foreign key(adapter_id,account_id,client_id) references public.enterprise_adapters(id,account_id,client_id);
create table public.enterprise_adapter_runs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,adapter_id uuid not null,created_by uuid not null,
 manifest jsonb not null check(jsonb_typeof(manifest)='object' and jsonb_array_length(manifest->'items') between 1 and 50 and octet_length(manifest::text)<=65536),
 created_at timestamptz not null default clock_timestamp(),unique(id,account_id,client_id,adapter_id),
 foreign key(adapter_id,account_id,client_id) references public.enterprise_adapters(id,account_id,client_id),foreign key(created_by,account_id) references public.profiles(id,account_id)
);
create table public.enterprise_adapter_observations (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,adapter_id uuid not null,run_id uuid not null,prompt_id uuid not null,event_id uuid not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),observed_at timestamptz not null,actual_model text not null,
 answer text not null check(char_length(answer) between 1 and 6000),citations jsonb check(citations is null or(jsonb_typeof(citations)='array' and jsonb_array_length(citations)<=20)),
 provenance text not null default 'connector_reported' check(provenance='connector_reported'),received_at timestamptz not null default clock_timestamp(),
 unique(id,account_id,client_id),unique(account_id,client_id,event_id),unique(account_id,client_id,run_id,prompt_id),
 foreign key(run_id,account_id,client_id,adapter_id) references public.enterprise_adapter_runs(id,account_id,client_id,adapter_id)
);
create index enterprise_adapter_observations_recent on public.enterprise_adapter_observations(account_id,client_id,observed_at desc);
create table public.enterprise_webhooks (
 id uuid primary key,account_id uuid not null,client_id uuid not null,created_by uuid not null,name text not null check(char_length(name) between 1 and 100),
 target_origin text not null,url_ciphertext bytea not null,url_key_id text not null,secret_ciphertext bytea not null,secret_key_id text not null,
 events text[] not null check(cardinality(events) between 1 and 3 and events <@ array['executive_report.ready','workflow.decided','adapter.observation']),
 created_at timestamptz not null default clock_timestamp(),revoked_at timestamptz,unique(id,account_id,client_id),
 foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade,foreign key(created_by,account_id) references public.profiles(id,account_id)
);
create table public.enterprise_events (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,type text not null check(type in('executive_report.ready','workflow.decided','adapter.observation')),
 source_id uuid not null,artifact_id uuid generated always as(case when type='executive_report.ready' then source_id end) stored,decision_id uuid generated always as(case when type='workflow.decided' then source_id end) stored,observation_id uuid generated always as(case when type='adapter.observation' then source_id end) stored,payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=32768),created_at timestamptz not null default clock_timestamp(),
 unique(account_id,client_id,type,source_id),unique(id,account_id,client_id),foreign key(client_id,account_id) references public.clients(id,account_id),
 foreign key(artifact_id,account_id,client_id) references public.enterprise_artifacts(id,account_id,client_id),foreign key(decision_id,account_id,client_id) references public.enterprise_decisions(id,account_id,client_id),foreign key(observation_id,account_id,client_id) references public.enterprise_adapter_observations(id,account_id,client_id)
);
create table public.enterprise_deliveries (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,event_id uuid not null,
 kind text not null check(kind in('email','webhook')),target_id uuid not null,endpoint_id uuid,recipient_id uuid,
 status text not null default 'queued' check(status in('queued','running','succeeded','failed','blocked','unknown')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 3),next_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,first_sent_at timestamptz,request_hash text check(request_hash is null or request_hash ~ '^[a-f0-9]{64}$'),reason text check(reason is null or reason ~ '^[A-Z0-9_]{1,80}$'),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 unique(account_id,client_id,event_id,kind,target_id),unique(id,account_id,client_id),
 foreign key(event_id,account_id,client_id) references public.enterprise_events(id,account_id,client_id),
 foreign key(endpoint_id,account_id,client_id) references public.enterprise_webhooks(id,account_id,client_id),foreign key(recipient_id,account_id) references public.profiles(id,account_id),
 check((kind='email' and recipient_id=target_id and endpoint_id is null) or(kind='webhook' and endpoint_id=target_id and recipient_id is null))
);
create index enterprise_deliveries_due on public.enterprise_deliveries(status,next_at,created_at);
create table public.enterprise_attempts (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,job_id uuid not null,job_kind text not null check(job_kind in('schedule','delivery')),period_id uuid generated always as(case when job_kind='schedule' then job_id end) stored,delivery_id uuid generated always as(case when job_kind='delivery' then job_id end) stored,
 number integer not null check(number between 1 and 3),lease_token uuid not null,
 status text not null default 'started' check(status in('started','succeeded','failed','blocked','unknown')),
 reason text check(reason is null or reason ~ '^[A-Z0-9_]{1,80}$'),http_status integer check(http_status between 100 and 599),
 started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,unique(account_id,client_id,job_kind,job_id,number),
 foreign key(client_id,account_id) references public.clients(id,account_id),foreign key(period_id,account_id,client_id) references public.enterprise_schedule_periods(id,account_id,client_id),foreign key(delivery_id,account_id,client_id) references public.enterprise_deliveries(id,account_id,client_id)
);
revoke all on public.enterprise_adapters,public.enterprise_adapter_runs,public.enterprise_adapter_observations,public.enterprise_webhooks,public.enterprise_events,public.enterprise_deliveries,public.enterprise_attempts from public;
do $$begin if to_regrole('aeo_app') is not null then
 -- 037 default privileges grant role-specific DML; PUBLIC revocation is insufficient.
 revoke all on public.enterprise_adapters,public.enterprise_adapter_runs,public.enterprise_adapter_observations,public.enterprise_webhooks,public.enterprise_events,public.enterprise_deliveries,public.enterprise_attempts from aeo_app;
 grant select,insert,update on public.enterprise_adapters,public.enterprise_webhooks,public.enterprise_deliveries,public.enterprise_attempts to aeo_app;
 grant select,insert on public.enterprise_adapter_runs,public.enterprise_adapter_observations,public.enterprise_events to aeo_app;
end if;end $$;

-- Revocation and its audit record share one account-serialized transaction.
create function public.enterprise_revoke_resource(p_account uuid,p_client uuid,p_actor uuid,p_kind text,p_id uuid) returns text language plpgsql as $$
 declare changed uuid; exists_owned boolean;
 begin
  perform id from public.accounts where id=p_account for update;
  perform id from public.profiles where id=p_actor for share;
  if public.enterprise_active_member_role(p_account,p_actor) is distinct from 'manager' then return 'DENIED';end if;
  if p_kind='portal' then
   select exists(select 1 from public.enterprise_portals where account_id=p_account and client_id=p_client and id=p_id) into exists_owned;
   update public.enterprise_portals set revoked_at=clock_timestamp() where account_id=p_account and client_id=p_client and id=p_id and revoked_at is null returning id into changed;
  elsif p_kind='key' then
   select exists(select 1 from public.enterprise_keys where account_id=p_account and client_id=p_client and id=p_id) into exists_owned;
   update public.enterprise_keys set revoked_at=clock_timestamp() where account_id=p_account and client_id=p_client and id=p_id and revoked_at is null returning id into changed;
  elsif p_kind='webhook' then
   select exists(select 1 from public.enterprise_webhooks where account_id=p_account and client_id=p_client and id=p_id) into exists_owned;
   update public.enterprise_webhooks set revoked_at=clock_timestamp() where account_id=p_account and client_id=p_client and id=p_id and revoked_at is null returning id into changed;
  elsif p_kind='adapter' then
   select exists(select 1 from public.enterprise_adapters where account_id=p_account and client_id=p_client and id=p_id) into exists_owned;
   update public.enterprise_adapters set revoked_at=clock_timestamp() where account_id=p_account and client_id=p_client and id=p_id and revoked_at is null returning id into changed;
  elsif p_kind='schedule' then
   select exists(select 1 from public.enterprise_schedules where account_id=p_account and client_id=p_client and id=p_id) into exists_owned;
   update public.enterprise_schedules set enabled=false where account_id=p_account and client_id=p_client and id=p_id and enabled returning id into changed;
  else return 'INVALID';end if;
  if not exists_owned then return 'NOT_FOUND';end if;
  if changed is null then return 'REPLAYED';end if;
  insert into public.enterprise_audit(account_id,client_id,actor_id,action,target_id,metadata) values(p_account,p_client,p_actor,'resource.revoked',p_id,jsonb_build_object('kind',p_kind));
  return 'CREATED';
 end $$;
revoke execute on function public.enterprise_revoke_resource(uuid,uuid,uuid,text,uuid) from public;
do $$begin if to_regrole('aeo_app') is not null then grant execute on function public.enterprise_revoke_resource(uuid,uuid,uuid,text,uuid) to aeo_app;end if;end $$;
