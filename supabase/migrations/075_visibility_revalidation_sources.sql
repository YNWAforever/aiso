-- Minimum page-identity prerequisite: compact, owned target checks, no site crawl.
alter table public.visibility_settings add column last_checked_at timestamptz;
create table public.visibility_page_snapshots (
  id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,
  url text not null check(char_length(url)<=2048),observed_at timestamptz not null,
  evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=8192),
  provenance text not null check(provenance in ('manual','closed_loop','routine')),created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(created_by,account_id) references public.profiles(id,account_id),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create index visibility_page_snapshots_latest on public.visibility_page_snapshots(account_id,client_id,url,observed_at desc);
create table public.visibility_completion_events (
  id uuid primary key default gen_random_uuid(),account_id uuid not null,client_id uuid not null,
  work_item_id uuid not null,item_revision integer not null,target_url text,
  completed_at timestamptz not null default clock_timestamp(),
  foreign key(work_item_id,client_id,account_id) references public.evidence_work_items(id,client_id,account_id) on delete cascade,
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
create index visibility_completion_events_scope on public.visibility_completion_events(account_id,client_id,completed_at);
create function public.record_visibility_work_completion() returns trigger language plpgsql set search_path=public as $$
begin
  if new.operation_status='done' and old.operation_status is distinct from 'done' then
    insert into public.visibility_completion_events(account_id,client_id,work_item_id,item_revision,target_url)
      values(new.account_id,new.client_id,new.id,new.revision,new.target_url);
  end if;
  return new;
end $$;
create trigger visibility_work_completion after update of operation_status on public.evidence_work_items
  for each row execute function public.record_visibility_work_completion();
alter table public.visibility_revalidations add column requested_by uuid,
  add constraint visibility_revalidation_requester_scope foreign key(requested_by,account_id) references public.profiles(id,account_id);
alter table public.visibility_revalidations drop constraint visibility_revalidations_status_check;
alter table public.visibility_revalidations add constraint visibility_revalidations_status_check
  check(status in ('queued','running','waiting','completed','blocked','failed','unknown'));
alter table public.visibility_revalidations drop constraint visibility_revalidations_urls_check;
alter table public.visibility_revalidations add constraint visibility_revalidation_urls_check
  check(jsonb_typeof(urls)='array' and jsonb_array_length(urls)<=20 and (jsonb_array_length(urls)>0 or status='blocked'));
revoke all on public.visibility_page_snapshots,public.visibility_completion_events from public;
do $$ begin if to_regrole('aeo_app') is not null then
  revoke all on public.visibility_page_snapshots,public.visibility_completion_events from aeo_app;
  grant select,insert on public.visibility_page_snapshots,public.visibility_completion_events to aeo_app;
end if;end $$;
