create table if not exists public.google_drive_connections(
  id uuid primary key default gen_random_uuid(),
  connection_status text not null default 'disconnected' check (connection_status in ('disconnected','connected','expired','error')),
  connected_account_email text,
  connected_account_name text,
  scopes text[] not null default array[]::text[],
  token_expires_at timestamptz,
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.google_drive_tokens(
  connection_id uuid primary key references public.google_drive_connections(id) on delete cascade,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_iv text,
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_library_settings(
  id boolean primary key default true check (id),
  google_drive_connection_id uuid references public.google_drive_connections(id) on delete set null,
  root_drive_folder_id text,
  reference_library_folder_id text,
  media_library_folder_id text,
  last_sync_at timestamptz,
  sync_state text not null default 'not_configured',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.library_sync_runs(
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result_status text not null default 'running' check (result_status in ('running','success','partial','error')),
  files_added integer not null default 0,
  files_changed integer not null default 0,
  files_archived integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

alter table private.google_drive_tokens enable row level security;
revoke all on private.google_drive_tokens from public, anon, authenticated;

drop trigger if exists google_drive_connections_touch on public.google_drive_connections;
create trigger google_drive_connections_touch before update on public.google_drive_connections
  for each row execute function private.touch_updated_at();
drop trigger if exists workspace_library_settings_touch on public.workspace_library_settings;
create trigger workspace_library_settings_touch before update on public.workspace_library_settings
  for each row execute function private.touch_updated_at();

create index if not exists google_drive_connections_status_idx on public.google_drive_connections(connection_status);
create index if not exists library_sync_runs_started_at_idx on public.library_sync_runs(started_at);
