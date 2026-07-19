-- LadyTin Story Studio — baseline collaboration schema.
--
-- This file reconciles version control with the schema that was previously
-- applied directly to the live project exmvsczxgippzcbjdrrj (migration history
-- entries 20260719173023…20260719174239). It is written idempotently: running
-- it against the live database is a no-op; running it against a fresh database
-- recreates the same objects.
--
-- If you are linking a fresh local checkout to the live project, mark this file
-- as already applied instead of re-running it:
--   supabase migration repair --status applied 20260719173023

create schema if not exists private;

-- ---------- helper functions ----------
create or replace function private.project_role(target_project_id uuid)
returns text language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select role from public.project_members
  where project_id=target_project_id and user_id=(select auth.uid())
  limit 1
$$;

create or replace function private.touch_revision()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end $$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path to 'public'
as $$ begin new.updated_at=now(); return new; end $$;

create or replace function private.add_project_owner()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
begin
  insert into public.project_members(project_id,user_id,role) values(new.id,new.owner_id,'owner');
  return new;
end $$;

create or replace function private.cleanup_pinterest_recommendations()
returns trigger language plpgsql set search_path to 'public'
as $$ begin delete from public.pinterest_recommendations where project_id=old.project_id; return old; end $$;

create or replace function private.valid_project_storage_path(object_name text)
returns boolean language sql immutable
as $$
  select split_part(object_name,'/',1)='projects' and split_part(object_name,'/',2) ~* '^[0-9a-f-]{36}$'
$$;

create or replace function private.verify_ladytin_security()
returns table(check_name text, passed boolean, detail text)
language sql set search_path to 'public','storage','pg_catalog'
as $$
  select 'all_public_tables_rls',bool_and(c.relrowsecurity),string_agg(c.relname,', ')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
  union all
  select 'pinterest_tokens_not_granted_to_authenticated',not has_table_privilege('authenticated','public.pinterest_connections','select'),'pinterest_connections SELECT'
  union all
  select 'project_files_bucket_private',coalesce((select not public from storage.buckets where id='project-files'),false),'project-files';
$$;

-- ---------- tables ----------
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects(
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1
);

create table if not exists public.project_members(
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  invited_email text,
  created_at timestamptz not null default now(),
  primary key(project_id,user_id)
);

create table if not exists public.story_sets(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  raw_story_set_copy text not null default '',
  parse_status text not null default 'draft',
  parse_warnings jsonb not null default '[]'::jsonb,
  overall_direction text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1
);

create table if not exists public.assets(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  story_set_id uuid references public.story_sets(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  asset_type text not null check (asset_type in ('main','reference','logo')),
  original_filename text not null,
  mime_type text not null,
  storage_path text not null unique,
  byte_size bigint not null check (byte_size >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.slides(
  id uuid primary key default gen_random_uuid(),
  story_set_id uuid not null references public.story_sets(id) on delete cascade,
  slide_number integer not null check (slide_number > 0),
  role text not null default 'Development',
  overlay_text text not null default '',
  cta text not null default '',
  interaction text not null default '',
  direction text not null default '',
  content_description text not null default '',
  internal_note text not null default '',
  no_text_overlay boolean not null default false,
  caption_cc boolean not null default false,
  main_asset_id uuid references public.assets(id) on delete set null,
  reference_asset_id uuid references public.assets(id) on delete set null,
  reference_mode text not null default 'editorial_direction_only'
    check (reference_mode in ('pinterest_auto','pinterest_selected','manual_upload','editorial_direction_only')),
  pinterest_pin_id text,
  pinterest_match_score numeric,
  pinterest_match_reason text not null default '',
  reference_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  revision bigint not null default 1
);

create table if not exists public.project_invites(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor','viewer')),
  token text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.project_activity(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pinterest_connections(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  connected_by uuid not null references auth.users(id),
  pinterest_user_id text,
  board_id text,
  board_url text not null default 'https://pin.it/7mSBrJubi',
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  scope text not null default 'boards:read pins:read',
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.pinterest_connections is 'Encrypted Pinterest OAuth credentials; accessible only to server-side Edge Functions.';

create table if not exists public.pinterest_pins(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  pinterest_pin_id text not null,
  board_id text,
  pin_url text not null,
  title text not null default '',
  description text not null default '',
  alt_text text not null default '',
  dominant_colour text,
  thumbnail_url text,
  source_domain text,
  synced_at timestamptz not null default now(),
  visual_tags jsonb not null default '{}'::jsonb,
  design_analysis jsonb not null default '{}'::jsonb,
  analysis_hash text not null,
  raw_metadata jsonb not null default '{}'::jsonb
);
comment on table public.pinterest_pins is 'Cached Pinterest reference metadata for LadyTin Story Studio';

create table if not exists public.pinterest_recommendations(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  story_set_id uuid not null references public.story_sets(id) on delete cascade,
  slide_id uuid not null references public.slides(id) on delete cascade,
  content_hash text not null,
  board_hash text not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- triggers ----------
drop trigger if exists projects_add_owner on public.projects;
create trigger projects_add_owner after insert on public.projects
  for each row execute function private.add_project_owner();
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function private.touch_revision();
drop trigger if exists story_sets_touch on public.story_sets;
create trigger story_sets_touch before update on public.story_sets
  for each row execute function private.touch_revision();
drop trigger if exists slides_touch on public.slides;
create trigger slides_touch before update on public.slides
  for each row execute function private.touch_revision();
drop trigger if exists pinterest_connections_touch on public.pinterest_connections;
create trigger pinterest_connections_touch before update on public.pinterest_connections
  for each row execute function private.touch_updated_at();
drop trigger if exists pinterest_pin_cleanup on public.pinterest_pins;
create trigger pinterest_pin_cleanup after delete on public.pinterest_pins
  for each row execute function private.cleanup_pinterest_recommendations();

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.story_sets enable row level security;
alter table public.assets enable row level security;
alter table public.slides enable row level security;
alter table public.project_invites enable row level security;
alter table public.project_activity enable row level security;
alter table public.pinterest_connections enable row level security;
alter table public.pinterest_pins enable row level security;
alter table public.pinterest_recommendations enable row level security;

-- pinterest_connections deliberately has NO policies and no authenticated
-- grants: encrypted token material is only reachable via the service role
-- inside Edge Functions.
revoke all on public.pinterest_connections from anon, authenticated;

do $policies$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_read_self') then
    create policy profiles_read_self on public.profiles for select to authenticated using ((select auth.uid())=id);
    create policy profiles_insert_self on public.profiles for insert to authenticated with check ((select auth.uid())=id);
    create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='projects_read_members') then
    create policy projects_read_members on public.projects for select to authenticated using (private.project_role(id) is not null);
    create policy projects_insert_owner on public.projects for insert to authenticated with check (owner_id=(select auth.uid()));
    create policy projects_update_editors on public.projects for update to authenticated using (private.project_role(id) in ('owner','editor')) with check (private.project_role(id) in ('owner','editor'));
    create policy projects_delete_owner on public.projects for delete to authenticated using (owner_id=(select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_members' and policyname='members_read_members') then
    create policy members_read_members on public.project_members for select to authenticated using (private.project_role(project_id) is not null);
    create policy members_owner_insert on public.project_members for insert to authenticated with check (private.project_role(project_id)='owner');
    create policy members_owner_update on public.project_members for update to authenticated using (private.project_role(project_id)='owner') with check (private.project_role(project_id)='owner');
    create policy members_owner_delete on public.project_members for delete to authenticated using (private.project_role(project_id)='owner');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='story_sets' and policyname='story_sets_read') then
    create policy story_sets_read on public.story_sets for select to authenticated using (private.project_role(project_id) is not null);
    create policy story_sets_write on public.story_sets for all to authenticated using (private.project_role(project_id) in ('owner','editor')) with check (private.project_role(project_id) in ('owner','editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='assets' and policyname='assets_read') then
    create policy assets_read on public.assets for select to authenticated using (private.project_role(project_id) is not null);
    create policy assets_write on public.assets for all to authenticated using (private.project_role(project_id) in ('owner','editor')) with check (private.project_role(project_id) in ('owner','editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='slides' and policyname='slides_read') then
    create policy slides_read on public.slides for select to authenticated using (private.project_role((select project_id from public.story_sets where story_sets.id=slides.story_set_id)) is not null);
    create policy slides_write on public.slides for all to authenticated using (private.project_role((select project_id from public.story_sets where story_sets.id=slides.story_set_id)) in ('owner','editor')) with check (private.project_role((select project_id from public.story_sets where story_sets.id=slides.story_set_id)) in ('owner','editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_invites' and policyname='invites_owner_all') then
    create policy invites_owner_all on public.project_invites for all to authenticated using (private.project_role(project_id)='owner') with check (private.project_role(project_id)='owner');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_activity' and policyname='activity_read') then
    create policy activity_read on public.project_activity for select to authenticated using (private.project_role(project_id) is not null);
    create policy activity_insert on public.project_activity for insert to authenticated with check (user_id=(select auth.uid()) and private.project_role(project_id) is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pinterest_pins' and policyname='pinterest_pins_read') then
    create policy pinterest_pins_read on public.pinterest_pins for select to authenticated using (private.project_role(project_id) is not null);
    create policy pinterest_pins_write on public.pinterest_pins for all to authenticated using (private.project_role(project_id) in ('owner','editor')) with check (private.project_role(project_id) in ('owner','editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pinterest_recommendations' and policyname='pinterest_recommendations_read') then
    create policy pinterest_recommendations_read on public.pinterest_recommendations for select to authenticated using (private.project_role(project_id) is not null);
    create policy pinterest_recommendations_write on public.pinterest_recommendations for all to authenticated using (private.project_role(project_id) in ('owner','editor')) with check (private.project_role(project_id) in ('owner','editor'));
  end if;
end $policies$;

-- ---------- storage ----------
insert into storage.buckets (id,name,public) values ('project-files','project-files',false)
on conflict (id) do update set public=false;

do $storage_policies$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='project_files_read') then
    create policy project_files_read on storage.objects for select to authenticated
      using (bucket_id='project-files' and private.valid_project_storage_path(name) and private.project_role(((storage.foldername(name))[2])::uuid) is not null);
    create policy project_files_insert on storage.objects for insert to authenticated
      with check (bucket_id='project-files' and private.valid_project_storage_path(name) and private.project_role(((storage.foldername(name))[2])::uuid) in ('owner','editor'));
    create policy project_files_update on storage.objects for update to authenticated
      using (bucket_id='project-files' and private.valid_project_storage_path(name) and private.project_role(((storage.foldername(name))[2])::uuid) in ('owner','editor'))
      with check (bucket_id='project-files' and private.valid_project_storage_path(name) and private.project_role(((storage.foldername(name))[2])::uuid) in ('owner','editor'));
    create policy project_files_delete on storage.objects for delete to authenticated
      using (bucket_id='project-files' and private.valid_project_storage_path(name) and private.project_role(((storage.foldername(name))[2])::uuid) in ('owner','editor'));
  end if;
end $storage_policies$;

-- ---------- realtime ----------
do $realtime$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='projects') then
    alter publication supabase_realtime add table public.projects;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='story_sets') then
    alter publication supabase_realtime add table public.story_sets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='slides') then
    alter publication supabase_realtime add table public.slides;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='assets') then
    alter publication supabase_realtime add table public.assets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='project_members') then
    alter publication supabase_realtime add table public.project_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='pinterest_pins') then
    alter publication supabase_realtime add table public.pinterest_pins;
  end if;
end $realtime$;
