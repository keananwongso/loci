-- Accounts are managed by Supabase Auth. Board contents stay in the browser.
create table if not exists public.loci_billing (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  status text not null default 'none',
  period_start bigint not null default 0,
  period_end bigint not null default 0,
  cancel_at_period_end boolean not null default false,
  observed_at bigint not null default 0
);
alter table public.loci_billing enable row level security;
-- No client write policies: only verified server requests can change billing.
revoke all on public.loci_billing from anon, authenticated;
grant all on public.loci_billing to service_role;

create or replace function public.loci_sync_billing(
  p_customer text, p_subscription text, p_status text, p_start bigint,
  p_end bigint, p_cancel boolean, p_observed bigint
) returns void language sql security invoker set search_path = '' as $$
  update public.loci_billing set
    stripe_subscription_id = p_subscription, status = p_status,
    period_start = p_start, period_end = p_end,
    cancel_at_period_end = p_cancel, observed_at = p_observed
  where stripe_customer_id = p_customer and observed_at <= p_observed;
$$;
revoke all on function public.loci_sync_billing(text,text,text,bigint,bigint,boolean,bigint) from public, anon, authenticated;
grant execute on function public.loci_sync_billing(text,text,text,bigint,bigint,boolean,bigint) to service_role;
