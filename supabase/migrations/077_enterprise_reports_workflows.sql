create table public.enterprise_branding (
 account_id uuid not null,client_id uuid not null,configuration jsonb not null check(jsonb_typeof(configuration)='object' and octet_length(configuration::text)<=4096),
 updated_by uuid not null,updated_at timestamptz not null default now(),primary key(account_id,client_id),
 foreign key(client_id,account_id) references public.clients(id,account_id),foreign key(updated_by,account_id) references public.profiles(id,account_id)
);
create table public.enterprise_artifacts (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,
 kind text not null check(kind in('executive_report','schedule','visibility_draft')),source_id uuid,
 created_by uuid not null,submitted_by uuid,payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=case when kind='visibility_draft' then 131072 else 32768 end),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),unique(id,account_id,client_id),unique(id,account_id,client_id,content_hash),
 foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade,
 foreign key(created_by,account_id) references public.profiles(id,account_id),foreign key(submitted_by,account_id) references public.profiles(id,account_id)
);
create function public.enterprise_hash_artifact() returns trigger language plpgsql as $$
begin new.content_hash:=encode(sha256(convert_to(new.payload::text,'UTF8')),'hex');return new;end $$;
create trigger enterprise_artifact_hash before insert on public.enterprise_artifacts for each row execute function public.enterprise_hash_artifact();
create index enterprise_artifacts_recent on public.enterprise_artifacts(account_id,client_id,created_at desc,id desc);
create table public.enterprise_decisions (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,artifact_id uuid not null,content_hash text not null,
 decision text not null check(decision in('approved','rejected')),reason text not null check(char_length(reason) between 1 and 1000),
 actor_id uuid not null,grant_revision integer not null,grant_event_id uuid not null,request_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),unique(id,account_id,client_id),unique(id,account_id,client_id,artifact_id,decision),unique(account_id,client_id,artifact_id),
 foreign key(artifact_id,account_id,client_id,content_hash) references public.enterprise_artifacts(id,account_id,client_id,content_hash),
 foreign key(account_id,actor_id,grant_revision,grant_event_id) references public.account_approver_events(account_id,profile_id,new_revision,id)
);
create table public.enterprise_portals (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,artifact_id uuid not null,content_hash text not null,
 slug text not null unique check(slug ~ '^[A-Za-z0-9_-]{32}$'),version integer not null default 1 check(version>0),published_by uuid not null,
 published_at timestamptz not null default clock_timestamp(),revoked_at timestamptz,unique(account_id,client_id,artifact_id),
 foreign key(artifact_id,account_id,client_id,content_hash) references public.enterprise_artifacts(id,account_id,client_id,content_hash),
 foreign key(published_by,account_id) references public.profiles(id,account_id)
);
create table public.enterprise_schedules (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,artifact_id uuid not null,created_by uuid not null,
 enabled boolean not null default false,approved_decision_id uuid,approval_decision text generated always as(case when approved_decision_id is not null then 'approved' end) stored,next_period_start date,approved_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 unique(artifact_id,account_id,client_id),unique(id,account_id,client_id),check(not enabled or(approved_decision_id is not null and approved_at is not null and next_period_start is not null)),foreign key(approved_decision_id,account_id,client_id,artifact_id,approval_decision) references public.enterprise_decisions(id,account_id,client_id,artifact_id,decision),
 foreign key(artifact_id,account_id,client_id) references public.enterprise_artifacts(id,account_id,client_id),
 foreign key(created_by,account_id) references public.profiles(id,account_id)
);
create table public.enterprise_schedule_periods (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,schedule_id uuid not null,
 period_start date not null,period_end date not null check(period_end>=period_start),artifact_id uuid,
 status text not null default 'queued' check(status in('queued','running','completed','failed','blocked','unknown')),
 reason text check(reason is null or reason ~ '^[A-Z0-9_]{1,80}$'),attempt_count integer not null default 0 check(attempt_count between 0 and 3),
 lease_token uuid,lease_until timestamptz,result jsonb,next_at timestamptz not null default now(),created_at timestamptz not null default now(),finished_at timestamptz,
 unique(account_id,client_id,schedule_id,period_start),unique(id,account_id,client_id),
 foreign key(schedule_id,account_id,client_id) references public.enterprise_schedules(id,account_id,client_id),
 foreign key(artifact_id,account_id,client_id) references public.enterprise_artifacts(id,account_id,client_id)
);
create function public.enterprise_decide(p_account uuid,p_client uuid,p_artifact uuid,p_actor uuid,p_decision text,p_reason text,p_request uuid)
 returns text language plpgsql as $$
 declare target public.enterprise_artifacts; grant_row public.account_approver_state; prior public.enterprise_decisions; decision_id uuid;
 begin
  perform id from public.accounts where id=p_account for update;
  perform id from public.profiles where id=p_actor for share;
  select * into target from public.enterprise_artifacts where account_id=p_account and client_id=p_client and id=p_artifact;
  if not found then return 'NOT_FOUND';end if;
  if public.enterprise_active_member_role(p_account,p_actor) is null then return 'DENIED';end if;
  select s.* into grant_row from public.account_approver_state s join public.account_approver_events e
   on e.account_id=s.account_id and e.profile_id=s.profile_id and e.new_revision=s.revision and e.id=s.last_event_id and e.action='grant'
   where s.account_id=p_account and s.profile_id=p_actor and s.active is true for share of s;
  if not found or p_actor=target.created_by or p_actor=target.submitted_by then return 'DENIED';end if;
  if p_decision not in('approved','rejected') or char_length(p_reason) not between 1 and 1000 then return 'INVALID';end if;
  select * into prior from public.enterprise_decisions where account_id=p_account and client_id=p_client and artifact_id=p_artifact;
  if found then
   if prior.actor_id=p_actor and prior.request_id=p_request and prior.decision=p_decision and prior.reason=p_reason then return 'REPLAYED';end if;
   return 'CONFLICT';
  end if;
  insert into public.enterprise_decisions(account_id,client_id,artifact_id,content_hash,decision,reason,actor_id,grant_revision,grant_event_id,request_id)
   values(p_account,p_client,p_artifact,target.content_hash,p_decision,p_reason,p_actor,grant_row.revision,grant_row.last_event_id,p_request) returning id into decision_id;
  if target.kind='schedule' and p_decision='approved' then
   update public.enterprise_schedules set enabled=coalesce((target.payload->>'enabled')::boolean,false),approved_decision_id=decision_id,approved_at=clock_timestamp(),next_period_start=date_trunc(case when target.payload->>'cadence'='weekly' then 'week' else 'month' end,clock_timestamp() at time zone 'UTC')::date
    where account_id=p_account and client_id=p_client and artifact_id=p_artifact and public.enterprise_active_member_role(p_account,created_by)='manager';
  end if;
  insert into public.enterprise_audit(account_id,client_id,actor_id,action,target_id,metadata)
   values(p_account,p_client,p_actor,'workflow.decided',p_artifact,jsonb_build_object('decision',p_decision,'contentHash',target.content_hash,'decisionId',decision_id));
  return 'CREATED';
 end $$;
create function public.enterprise_publish_portal(p_account uuid,p_client uuid,p_artifact uuid,p_actor uuid,p_slug text)
 returns setof public.enterprise_portals language plpgsql as $$
 declare target public.enterprise_artifacts; portal_id uuid; portal_version integer;
 begin
  perform id from public.accounts where id=p_account for update;
  perform id from public.profiles where id=p_actor for share;
  if public.enterprise_active_member_role(p_account,p_actor) is distinct from 'manager' then return;end if;
  select a.* into target from public.enterprise_artifacts a join public.enterprise_decisions d
   on d.account_id=a.account_id and d.client_id=a.client_id and d.artifact_id=a.id and d.content_hash=a.content_hash and d.decision='approved'
   where a.account_id=p_account and a.client_id=p_client and a.id=p_artifact and a.kind='executive_report';
  if not found then return;end if;
  insert into public.enterprise_portals(account_id,client_id,artifact_id,content_hash,slug,published_by)
   values(p_account,p_client,p_artifact,target.content_hash,p_slug,p_actor) on conflict(account_id,client_id,artifact_id) do update set slug=excluded.slug,version=enterprise_portals.version+1,published_by=excluded.published_by,published_at=clock_timestamp(),revoked_at=null
   where enterprise_portals.revoked_at is not null returning id,version into portal_id,portal_version;
  if portal_id is not null then
   insert into public.enterprise_audit(account_id,client_id,actor_id,action,target_id,metadata) values(p_account,p_client,p_actor,'portal.published',portal_id,jsonb_build_object('artifactId',p_artifact,'contentHash',target.content_hash,'version',portal_version));
  end if;
  return query select * from public.enterprise_portals where account_id=p_account and client_id=p_client and artifact_id=p_artifact and revoked_at is null;
 end $$;
revoke all on public.enterprise_branding,public.enterprise_artifacts,public.enterprise_decisions,public.enterprise_portals,public.enterprise_schedules,public.enterprise_schedule_periods from public;
revoke execute on function public.enterprise_hash_artifact() from public;
revoke execute on function public.enterprise_decide(uuid,uuid,uuid,uuid,text,text,uuid),public.enterprise_publish_portal(uuid,uuid,uuid,uuid,text) from public;
do $$begin if to_regrole('aeo_app') is not null then
 -- 037 default privileges grant role-specific DML; PUBLIC revocation is insufficient.
 revoke all on public.enterprise_branding,public.enterprise_artifacts,public.enterprise_decisions,public.enterprise_portals,public.enterprise_schedules,public.enterprise_schedule_periods from aeo_app;
 grant select,insert on public.enterprise_artifacts,public.enterprise_decisions to aeo_app;
 grant select,insert,update on public.enterprise_branding,public.enterprise_portals,public.enterprise_schedules,public.enterprise_schedule_periods to aeo_app;
 grant execute on function public.enterprise_decide(uuid,uuid,uuid,uuid,text,text,uuid),public.enterprise_publish_portal(uuid,uuid,uuid,uuid,text) to aeo_app;
end if;end $$;
