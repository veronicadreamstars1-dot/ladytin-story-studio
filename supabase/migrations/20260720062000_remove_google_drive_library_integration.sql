-- Remove the abandoned Google Drive library integration.
--
-- Live inspection before this migration showed:
-- - public.google_drive_connections: 0 rows
-- - private.google_drive_tokens: 0 rows
-- - public.workspace_library_settings: 0 rows
-- - public.library_sync_runs: 0 rows
-- - public.library_items: 98 rows, all source_type='supabase_storage',
--   all with storage_path, and zero Google Drive ID/link/timestamp values.

drop table if exists private.google_drive_tokens cascade;
drop table if exists public.library_sync_runs cascade;
drop table if exists public.workspace_library_settings cascade;
drop table if exists public.google_drive_connections cascade;

drop index if exists public.library_items_google_drive_file_id_idx;

alter table public.library_items
  drop constraint if exists library_items_has_source,
  drop constraint if exists library_items_source_type_check;

update public.library_items
set source_type='supabase_storage'
where source_type is distinct from 'supabase_storage';

alter table public.library_items
  drop column if exists google_drive_file_id,
  drop column if exists google_drive_parent_id,
  drop column if exists google_drive_web_view_link,
  drop column if exists google_drive_modified_at,
  alter column source_type set default 'supabase_storage',
  alter column source_type set not null,
  alter column storage_path set not null;

alter table public.library_items
  add constraint library_items_source_type_check
    check (source_type='supabase_storage'),
  add constraint library_items_has_source
    check (storage_path is not null);

comment on table public.library_items is 'Shared LadyTin Reference and Media library metadata. Original binaries live in private Supabase Storage.';
