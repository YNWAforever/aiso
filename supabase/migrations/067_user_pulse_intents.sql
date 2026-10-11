-- Durable user intents and operational workload reservations. No historical backfill or automatic provider call.
create table public.pulse_user_intents(
 account_id uuid not null,client_id uuid not null,intent_key text not null check(length(intent_key) between 8 and 128),
 request_hash text not null,run_id uuid not null,kind text not null check(kind in ('initial','repair','retest')),created_at timestamptz not null default now(),
 primary key(account_id,client_id,intent_key),foreign key(run_id,client_id,account_id) references public.pulse_runs(id,client_id,account_id)
);
create table public.pulse_run_reservations(
 run_id uuid primary key,account_id uuid not null,client_id uuid not null,scan_week date not null,
 reserved_units integer not null check(reserved_units between 0 and 250),created_at timestamptz not null default now(),
 foreign key(run_id,client_id,account_id) references public.pulse_runs(id,client_id,account_id)
);
create index pulse_reservations_account_week on public.pulse_run_reservations(account_id,scan_week);
revoke update,delete on public.pulse_user_intents,public.pulse_run_reservations from aeo_app;
grant select,insert on public.pulse_user_intents,public.pulse_run_reservations to aeo_app;
