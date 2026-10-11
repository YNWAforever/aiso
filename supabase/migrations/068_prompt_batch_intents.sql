-- Additive local-first journal. No historical questions or manifests rewritten.
create table public.prompt_batch_intents(account_id uuid not null,client_id uuid not null,intent_key text not null check(length(intent_key) between 8 and 128),request_hash text not null,result jsonb,created_at timestamptz not null default now(),primary key(account_id,client_id,intent_key),foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade);
revoke all on public.prompt_batch_intents from public;
grant select,insert on public.prompt_batch_intents to aeo_app;
grant update(result) on public.prompt_batch_intents to aeo_app;
