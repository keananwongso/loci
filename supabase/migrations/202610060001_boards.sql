-- Signed-in users' boards, optional spaces and uploaded files. As with loci_billing, only the
-- server's service role touches these; every route verifies the user and filters by user_id.
create table if not exists public.loci_spaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loci_spaces_user on public.loci_spaces(user_id);

create table if not exists public.loci_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Spaces are optional: a board without one is simply unsorted.
  space_id uuid references public.loci_spaces(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  snapshot jsonb,
  conversation jsonb not null default '[]'::jsonb,
  -- Bumped on every content save; a save from a stale copy is refused instead of overwriting.
  version integer not null default 0,
  bytes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loci_boards_user on public.loci_boards(user_id, updated_at desc);

-- Uploaded material, replay recordings and their audio, counted against the account's storage.
create table if not exists public.loci_files (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9_-]{1,120}$'),
  board_id uuid references public.loci_boards(id) on delete set null,
  bytes bigint not null check (bytes >= 0),
  content_type text not null,
  committed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.loci_spaces enable row level security;
alter table public.loci_boards enable row level security;
alter table public.loci_files enable row level security;
revoke all on public.loci_spaces, public.loci_boards, public.loci_files from anon, authenticated;
grant all on public.loci_spaces, public.loci_boards, public.loci_files to service_role;

-- A content save succeeds only from the version the client last saw.
create or replace function public.loci_save_board(
  p_user uuid, p_board uuid, p_base integer, p_snapshot jsonb, p_conversation jsonb, p_bytes integer
) returns integer language sql security invoker set search_path = '' as $$
  update public.loci_boards set
    snapshot = p_snapshot, conversation = p_conversation, bytes = p_bytes,
    version = version + 1, updated_at = now()
  where id = p_board and user_id = p_user and version = p_base
  returning version;
$$;
revoke all on function public.loci_save_board(uuid,uuid,integer,jsonb,jsonb,integer) from public, anon, authenticated;
grant execute on function public.loci_save_board(uuid,uuid,integer,jsonb,jsonb,integer) to service_role;

-- Bytes an account is using: board content plus committed and pending uploads.
create or replace function public.loci_storage_used(p_user uuid)
returns bigint language sql stable security invoker set search_path = '' as $$
  select coalesce((select sum(bytes) from public.loci_boards where user_id = p_user), 0)
       + coalesce((select sum(bytes) from public.loci_files where user_id = p_user), 0);
$$;
revoke all on function public.loci_storage_used(uuid) from public, anon, authenticated;
grant execute on function public.loci_storage_used(uuid) to service_role;

-- Private bucket; objects are reached only through server-issued signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('loci-files', 'loci-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
