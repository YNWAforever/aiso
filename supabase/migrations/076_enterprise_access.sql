-- Enterprise OS: application-scoped access, no new identity provider or delegated grants.
create table public.enterprise_role_events (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id) on delete cascade,
 profile_id uuid not null,role text not null check(role in ('viewer','editor','manager')),
 previous_revision integer not null check(previous_revision>=0),revision integer not null check(revision=previous_revision+1),
 actor_id uuid not null references public.profiles(id),request_id uuid not null,reason text not null check(char_length(reason) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(),unique(account_id,actor_id,request_id),unique(account_id,profile_id,revision,id,role),
 foreign key(profile_id,account_id) references public.profiles(id,account_id)
);
create table public.enterprise_roles (
 account_id uuid not null,profile_id uuid not null,role text not null,revision integer not null,event_id uuid not null,
 primary key(account_id,profile_id),foreign key(account_id,profile_id,revision,event_id,role)
 references public.enterprise_role_events(account_id,profile_id,revision,id,role)
);
create table public.enterprise_audit (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id) on delete cascade,
 client_id uuid,actor_id uuid references public.profiles(id),action text not null check(action ~ '^[a-z_.]{1,80}$'),
 target_id uuid not null,metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=8192),
 created_at timestamptz not null default clock_timestamp(),foreign key(client_id,account_id) references public.clients(id,account_id)
);
create index enterprise_audit_recent on public.enterprise_audit(account_id,client_id,created_at desc,id desc);
create function public.enterprise_member_role(p_account uuid,p_actor uuid) returns text language sql stable as $$
 select coalesce((select r.role from public.enterprise_roles r join public.enterprise_role_events e
   on e.account_id=r.account_id and e.profile_id=r.profile_id and e.revision=r.revision and e.id=r.event_id and e.role=r.role
   where r.account_id=p_account and r.profile_id=p_actor),'viewer')
 from public.profiles p where p.id=p_actor and p.account_id=p_account and p.deactivated_at is null
$$;
-- Matches resolveCommercialEntitlement for the Enterprise-only capability set.
create function public.enterprise_account_entitled(p_account uuid) returns boolean language sql stable as $$
 select coalesce((select case
  when a.override_plan in('free','basic','pro','enterprise') and(a.override_expires_at is null or(isfinite(a.override_expires_at) and a.override_expires_at>clock_timestamp())) then a.override_plan='enterprise'
  when a.status in('past_due','cancelled') then false
  else a.plan='enterprise' and((a.status='active' and length(a.stripe_subscription_id)>0) or(isfinite(a.trial_ends_at) and a.trial_ends_at>clock_timestamp()) or(a.status='trialing' and length(a.stripe_subscription_id)>0)) end
  from public.accounts a where a.id=p_account),false)
$$;
create function public.enterprise_active_member_role(p_account uuid,p_actor uuid) returns text language sql stable as $$
 select public.enterprise_member_role(p_account,p_actor) where public.enterprise_account_entitled(p_account)
$$;
create function public.enterprise_set_role(p_account uuid,p_actor uuid,p_target uuid,p_role text,p_revision integer,p_request uuid,p_reason text)
 returns text language plpgsql as $$
 declare prior public.enterprise_role_events; current_revision integer; event_id uuid;
 begin
  perform id from public.accounts where id=p_account for update;
  perform id from public.profiles where id in(p_actor,p_target) order by id for update;
  if not exists(select 1 from public.profiles where id=p_actor and is_admin is true and deactivated_at is null) then return 'DENIED';end if;
  if not exists(select 1 from public.profiles where id=p_target and account_id=p_account and deactivated_at is null) then return 'NOT_FOUND';end if;
  if p_role not in('viewer','editor','manager') or p_revision<0 or char_length(p_reason) not between 1 and 1000 then return 'INVALID';end if;
  select * into prior from public.enterprise_role_events where account_id=p_account and actor_id=p_actor and request_id=p_request;
  if found then
   if prior.profile_id=p_target and prior.role=p_role and prior.previous_revision=p_revision and prior.reason=p_reason then return 'REPLAYED';end if;
   return 'CONFLICT';
  end if;
  select revision into current_revision from public.enterprise_roles where account_id=p_account and profile_id=p_target;
  if coalesce(current_revision,0)<>p_revision then return 'CONFLICT';end if;
  insert into public.enterprise_role_events(account_id,profile_id,role,previous_revision,revision,actor_id,request_id,reason)
   values(p_account,p_target,p_role,p_revision,p_revision+1,p_actor,p_request,p_reason) returning id into event_id;
  insert into public.enterprise_roles values(p_account,p_target,p_role,p_revision+1,event_id)
   on conflict(account_id,profile_id) do update set role=excluded.role,revision=excluded.revision,event_id=excluded.event_id;
  insert into public.enterprise_audit(account_id,actor_id,action,target_id,metadata) values(p_account,p_actor,'role.changed',p_target,jsonb_build_object('role',p_role,'revision',p_revision+1,'eventId',event_id));
  return 'CREATED';
 end $$;
create table public.enterprise_keys (
 id uuid primary key,account_id uuid not null,client_id uuid not null,created_by uuid not null,name text not null check(char_length(name) between 1 and 100),
 scopes text[] not null check(cardinality(scopes) between 1 and 4 and scopes <@ array['outcomes:read','visibility:read','reports:read','adapter:write']),
 adapter_id uuid,ciphertext bytea not null,key_id text not null,revoked_at timestamptz,created_at timestamptz not null default now(),
 unique(id,account_id,client_id),foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade,
 foreign key(created_by,account_id) references public.profiles(id,account_id),check(not('adapter:write'=any(scopes)) or adapter_id is not null)
);
create table public.enterprise_api_nonces (
 account_id uuid not null,key_id uuid not null,client_id uuid not null,nonce uuid not null,expires_at timestamptz not null,
 primary key(account_id,key_id,nonce),foreign key(key_id,account_id,client_id) references public.enterprise_keys(id,account_id,client_id) on delete cascade
);
create index enterprise_api_nonces_expiry on public.enterprise_api_nonces(expires_at);
create table public.enterprise_api_windows (
 account_id uuid not null references public.accounts(id) on delete cascade,kind text not null check(kind in('account','key')),scope_id uuid not null,
 period timestamptz not null,used integer not null check(used>=0),primary key(account_id,kind,scope_id,period)
);
create function public.enterprise_consume_request(p_account uuid,p_client uuid,p_key uuid,p_nonce uuid,p_scope text)
 returns text language plpgsql as $$
 declare stamp timestamptz; key_count integer; account_count integer;
 begin
  -- One account lock serializes previously absent nonce/counter rows as well.
  -- Subsequent PL/pgSQL statements take fresh READ COMMITTED snapshots.
  perform id from public.accounts where id=p_account for update;
  stamp:=date_trunc('minute',clock_timestamp());
  if not exists(select 1 from public.enterprise_keys k where k.account_id=p_account and k.client_id=p_client and k.id=p_key
    and k.revoked_at is null and p_scope=any(k.scopes) and public.enterprise_active_member_role(p_account,k.created_by)='manager') then return 'DENIED';end if;
  delete from public.enterprise_api_nonces where account_id=p_account and expires_at<clock_timestamp();
  delete from public.enterprise_api_windows where account_id=p_account and period<stamp-interval '2 minutes';
  if exists(select 1 from public.enterprise_api_nonces where account_id=p_account and key_id=p_key and nonce=p_nonce) then return 'REPLAY';end if;
  select used into key_count from public.enterprise_api_windows where account_id=p_account and kind='key' and scope_id=p_key and period=stamp;
  select used into account_count from public.enterprise_api_windows where account_id=p_account and kind='account' and scope_id=p_account and period=stamp;
  if coalesce(key_count,0)>=60 or coalesce(account_count,0)>=600 then return 'RATE_LIMITED';end if;
  insert into public.enterprise_api_nonces values(p_account,p_key,p_client,p_nonce,clock_timestamp()+interval '11 minutes');
  insert into public.enterprise_api_windows values(p_account,'key',p_key,stamp,1),(p_account,'account',p_account,stamp,1)
   on conflict(account_id,kind,scope_id,period) do update set used=enterprise_api_windows.used+1;
  return 'OK';
 end $$;
revoke all on public.enterprise_role_events,public.enterprise_roles,public.enterprise_audit,public.enterprise_keys,public.enterprise_api_nonces,public.enterprise_api_windows from public;
revoke execute on function public.enterprise_account_entitled(uuid),public.enterprise_active_member_role(uuid,uuid) from public;
revoke execute on function public.enterprise_member_role(uuid,uuid),public.enterprise_set_role(uuid,uuid,uuid,text,integer,uuid,text),public.enterprise_consume_request(uuid,uuid,uuid,uuid,text) from public;
do $$begin if to_regrole('aeo_app') is not null then
 grant select,insert on public.enterprise_role_events,public.enterprise_audit to aeo_app;
 grant select,insert,update on public.enterprise_roles,public.enterprise_keys to aeo_app;
 grant select,insert,update,delete on public.enterprise_api_nonces,public.enterprise_api_windows to aeo_app;
 grant execute on function public.enterprise_account_entitled(uuid),public.enterprise_active_member_role(uuid,uuid) to aeo_app;
 grant execute on function public.enterprise_member_role(uuid,uuid),public.enterprise_set_role(uuid,uuid,uuid,text,integer,uuid,text),public.enterprise_consume_request(uuid,uuid,uuid,uuid,text) to aeo_app;
end if;end $$;
