-- Provider credentials are encrypted by the app before reaching Postgres.
-- No browser role may read or mutate this table, even its ciphertext.
create table if not exists public.loci_provider_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ai', 'voice')),
  ciphertext text not null check (char_length(ciphertext) between 1 and 16000),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.loci_provider_keys enable row level security;
revoke all on public.loci_provider_keys from public, anon, authenticated;
grant select, insert, update, delete on public.loci_provider_keys to service_role;
