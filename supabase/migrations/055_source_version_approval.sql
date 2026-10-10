-- Existing version content remains append-only; only the paired approval
-- decision can change. Never broaden this to table-wide UPDATE or DELETE.
do $$ begin
  if to_regrole('aeo_app') is not null then
    grant update (approved_by, approved_at) on public.client_source_versions to aeo_app;
  end if;
end $$;
