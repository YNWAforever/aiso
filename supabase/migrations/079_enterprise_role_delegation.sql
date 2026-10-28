-- Willy-approved Phase 4 decision: an active Enterprise Manager administers
-- Viewer/Editor/Manager grants in their own account. Approver grants and global
-- profiles.is_admin remain separate, existing platform-admin authorities.
-- Additive upgrade: retained platform-only grant events are not rewritten.
alter table public.enterprise_role_events
 add column previous_role text check(previous_role in('viewer','editor','manager')),
 add column actor_authority text not null default 'platform_admin' check(actor_authority in('platform_admin','workspace_manager')),
 add column actor_role_revision integer,
 add column actor_role_event_id uuid,
 add column actor_role text generated always as(case when actor_authority='workspace_manager' then 'manager' end) stored,
 add constraint enterprise_role_event_authority check(
  (actor_authority='platform_admin' and actor_role_revision is null and actor_role_event_id is null)
  or(actor_authority='workspace_manager' and actor_role_revision is not null and actor_role_revision>0 and actor_role_event_id is not null)),
 add constraint enterprise_role_event_actor_lineage foreign key(account_id,actor_id,actor_role_revision,actor_role_event_id,actor_role)
  references public.enterprise_role_events(account_id,profile_id,revision,id,role);

create function public.enterprise_can_manage_roles(p_account uuid,p_actor uuid) returns boolean language sql stable as $$
 select public.enterprise_account_entitled(p_account) and exists(
  select 1 from public.profiles p where p.id=p_actor and p.deactivated_at is null
   and(p.is_admin is true or(p.account_id=p_account and public.enterprise_member_role(p_account,p_actor)='manager')))
$$;

create or replace function public.enterprise_set_role(p_account uuid,p_actor uuid,p_target uuid,p_role text,p_revision integer,p_request uuid,p_reason text)
 returns text language plpgsql as $$
 declare prior public.enterprise_role_events; current_revision integer; prior_role text; event_id uuid;
  platform_actor boolean; authority text; actor_revision integer; actor_event uuid; audit_metadata jsonb;
 begin
  -- Serialize even absent role state. These later statements use fresh READ
  -- COMMITTED snapshots after a competing grant/revocation has released locks.
  perform id from public.accounts where id=p_account for update;
  perform id from public.profiles where id in(p_actor,p_target) order by id for update;
  select is_admin is true into platform_actor from public.profiles where id=p_actor and deactivated_at is null;
  if not found then return 'DENIED';end if;
  if not platform_actor and public.enterprise_member_role(p_account,p_actor) is distinct from 'manager' then return 'DENIED';end if;
  if not public.enterprise_account_entitled(p_account) then return 'ENTITLEMENT_REQUIRED';end if;
  if not exists(select 1 from public.profiles where id=p_target and account_id=p_account and deactivated_at is null) then return 'NOT_FOUND';end if;
  -- Delegation acts on another member. An actor remains an administrator after
  -- changing a peer, preventing self-lockout and reciprocal demotion races.
  if not platform_actor and p_actor=p_target then return 'SELF_ROLE_CHANGE_DENIED';end if;
  if p_role is null or p_role not in('viewer','editor','manager') or p_revision is null or p_revision<0 or p_revision>=2147483647
    or p_request is null or p_reason is null or char_length(p_reason) not between 1 and 1000 then return 'INVALID';end if;
  select * into prior from public.enterprise_role_events where account_id=p_account and actor_id=p_actor and request_id=p_request;
  if found then
   if prior.profile_id=p_target and prior.role=p_role and prior.previous_revision=p_revision and prior.reason=p_reason then return 'REPLAYED';end if;
   return 'CONFLICT';
  end if;
  select r.revision,r.role into current_revision,prior_role from public.enterprise_roles r where account_id=p_account and profile_id=p_target;
  if coalesce(current_revision,0)<>p_revision then return 'CONFLICT';end if;
  prior_role:=coalesce(prior_role,'viewer');
  authority:=case when platform_actor then 'platform_admin' else 'workspace_manager' end;
  if not platform_actor then
   select r.revision,r.event_id into actor_revision,actor_event from public.enterprise_roles r
    where r.account_id=p_account and r.profile_id=p_actor and r.role='manager';
   if not found then return 'DENIED';end if;
  end if;
  insert into public.enterprise_role_events(account_id,profile_id,role,previous_role,previous_revision,revision,actor_id,actor_authority,actor_role_revision,actor_role_event_id,request_id,reason)
   values(p_account,p_target,p_role,prior_role,p_revision,p_revision+1,p_actor,authority,actor_revision,actor_event,p_request,p_reason) returning id into event_id;
  insert into public.enterprise_roles values(p_account,p_target,p_role,p_revision+1,event_id)
   on conflict(account_id,profile_id) do update set role=excluded.role,revision=excluded.revision,event_id=excluded.event_id;
  audit_metadata:=jsonb_build_object('previousRole',prior_role,'reason',p_reason,'revision',p_revision+1,'eventId',event_id,'authority',authority,'actorGrantEventId',actor_event,'actorGrantRevision',actor_revision);
  if current_revision is not null and prior_role<>p_role then
   insert into public.enterprise_audit(account_id,actor_id,action,target_id,metadata)
    values(p_account,p_actor,'role.revoked',p_target,audit_metadata||jsonb_build_object('role',prior_role));
  end if;
  insert into public.enterprise_audit(account_id,actor_id,action,target_id,metadata)
   values(p_account,p_actor,'role.granted',p_target,audit_metadata||jsonb_build_object('role',p_role));
  return 'CREATED';
 end $$;
revoke execute on function public.enterprise_can_manage_roles(uuid,uuid),public.enterprise_set_role(uuid,uuid,uuid,text,integer,uuid,text) from public;
do $$begin if to_regrole('aeo_app') is not null then
 grant execute on function public.enterprise_can_manage_roles(uuid,uuid),public.enterprise_set_role(uuid,uuid,uuid,text,integer,uuid,text) to aeo_app;
end if;end $$;
