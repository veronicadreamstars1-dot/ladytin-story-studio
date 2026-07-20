create table if not exists public.library_items(
  id uuid primary key default gen_random_uuid(),
  library_type text not null check (library_type in ('reference','media')),
  title text not null default '',
  description text not null default '',
  original_filename text not null,
  mime_type text not null default 'application/octet-stream',
  byte_size bigint not null default 0 check (byte_size >= 0),
  source_type text not null check (source_type in ('google_drive','supabase_storage','temporary_upload')),
  google_drive_file_id text,
  google_drive_parent_id text,
  google_drive_web_view_link text,
  google_drive_modified_at timestamptz,
  storage_path text unique,
  thumbnail_path text,
  media_category text not null default '',
  dominant_colours jsonb not null default '[]'::jsonb,
  visual_tags jsonb not null default '{}'::jsonb,
  design_analysis jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  content_hash text,
  usage_count bigint not null default 0,
  last_used_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  constraint library_items_has_source check (
    (source_type='google_drive' and google_drive_file_id is not null)
    or (source_type in ('supabase_storage','temporary_upload') and storage_path is not null)
  )
);

comment on table public.library_items is 'Shared LadyTin Reference and Media library metadata. Original binaries live in Google Drive or private Supabase Storage.';

drop trigger if exists library_items_touch on public.library_items;
create trigger library_items_touch before update on public.library_items
  for each row execute function private.touch_revision();

create index if not exists library_items_type_archived_idx on public.library_items(library_type,archived_at);
create index if not exists library_items_source_type_idx on public.library_items(source_type);
create index if not exists library_items_google_drive_file_id_idx on public.library_items(google_drive_file_id);
create index if not exists library_items_updated_at_idx on public.library_items(updated_at);
create index if not exists library_items_last_used_at_idx on public.library_items(last_used_at);
create index if not exists library_items_search_text_idx on public.library_items using gin(to_tsvector('simple', search_text));
