-- One notification per immutable regression result; reruns cannot lose or duplicate it.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check(type in ('sov_threshold','sov_wow_drop','sov_recovery','outcome_regression'));
alter table public.notifications add column outcome_regression_id uuid references public.outcome_regressions(id) on delete set null;

create unique index notifications_outcome_regression_unique on public.notifications(outcome_regression_id);
