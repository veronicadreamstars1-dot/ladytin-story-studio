create or replace function private.has_ladytin_shared_access()
returns boolean language sql stable security invoker
set search_path to 'public','pg_temp'
as $$
  select coalesce((auth.jwt()->'app_metadata'->>'ladytin_shared_access')::boolean,false)
    and coalesce((auth.jwt()->'app_metadata'->>'ladytin_shared_access_expires_at')::timestamptz,'epoch'::timestamptz)>now()
$$;

alter table public.library_items enable row level security;
alter table public.library_collections enable row level security;
alter table public.library_collection_items enable row level security;
alter table public.library_tags enable row level security;
alter table public.library_item_tags enable row level security;
alter table public.slide_asset_assignments enable row level security;
alter table public.google_drive_connections enable row level security;
alter table public.workspace_library_settings enable row level security;
alter table public.library_sync_runs enable row level security;

do $policies$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='library_items' and policyname='library_items_shared_read') then
    create policy library_items_shared_read on public.library_items for select to authenticated using (private.has_ladytin_shared_access());
    create policy library_items_shared_insert on public.library_items for insert to authenticated with check (private.has_ladytin_shared_access());
    create policy library_items_shared_update on public.library_items for update to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
    create policy library_items_shared_delete on public.library_items for delete to authenticated using (private.has_ladytin_shared_access());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='library_collections' and policyname='library_collections_shared_all') then
    create policy library_collections_shared_all on public.library_collections for all to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
    create policy library_collection_items_shared_all on public.library_collection_items for all to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
    create policy library_tags_shared_all on public.library_tags for all to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
    create policy library_item_tags_shared_all on public.library_item_tags for all to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='slide_asset_assignments' and policyname='slide_assignments_shared_read') then
    create policy slide_assignments_shared_read on public.slide_asset_assignments for select to authenticated
      using (private.project_role((select ss.project_id from public.slides s join public.story_sets ss on ss.id=s.story_set_id where s.id=slide_asset_assignments.slide_id)) is not null);
    create policy slide_assignments_shared_write on public.slide_asset_assignments for all to authenticated
      using (private.project_role((select ss.project_id from public.slides s join public.story_sets ss on ss.id=s.story_set_id where s.id=slide_asset_assignments.slide_id)) in ('owner','editor'))
      with check (private.project_role((select ss.project_id from public.slides s join public.story_sets ss on ss.id=s.story_set_id where s.id=slide_asset_assignments.slide_id)) in ('owner','editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='google_drive_connections' and policyname='drive_connections_shared_read') then
    create policy drive_connections_shared_read on public.google_drive_connections for select to authenticated using (private.has_ladytin_shared_access());
    create policy drive_connections_shared_write on public.google_drive_connections for all to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
    create policy workspace_library_settings_shared_all on public.workspace_library_settings for all to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
    create policy library_sync_runs_shared_read on public.library_sync_runs for select to authenticated using (private.has_ladytin_shared_access());
    create policy library_sync_runs_shared_insert on public.library_sync_runs for insert to authenticated with check (private.has_ladytin_shared_access());
    create policy library_sync_runs_shared_update on public.library_sync_runs for update to authenticated using (private.has_ladytin_shared_access()) with check (private.has_ladytin_shared_access());
  end if;
end $policies$;

grant select,insert,update,delete on public.library_items to authenticated;
grant select,insert,update,delete on public.library_collections to authenticated;
grant select,insert,update,delete on public.library_collection_items to authenticated;
grant select,insert,update,delete on public.library_tags to authenticated;
grant select,insert,update,delete on public.library_item_tags to authenticated;
grant select,insert,update,delete on public.slide_asset_assignments to authenticated;
grant select,insert,update,delete on public.google_drive_connections to authenticated;
grant select,insert,update,delete on public.workspace_library_settings to authenticated;
grant select,insert,update on public.library_sync_runs to authenticated;

create or replace function public.get_library_item_usage(target_item_id uuid)
returns table(project_id uuid, project_title text, story_set_id uuid, story_set_title text, slide_id uuid, slide_number integer, assignment_role text)
language sql stable security invoker
set search_path to 'public','pg_temp'
as $$
  select p.id,p.title,ss.id,ss.title,s.id,s.slide_number,
    case when s.main_library_item_id=target_item_id then 'main_asset' else 'reference' end
  from public.slides s
  join public.story_sets ss on ss.id=s.story_set_id
  join public.projects p on p.id=ss.project_id
  where (s.main_library_item_id=target_item_id or s.reference_library_item_id=target_item_id)
    and private.project_role(p.id) is not null
  order by p.title,ss.sort_order,s.slide_number
$$;

create or replace function public.archive_library_item(target_item_id uuid)
returns public.library_items language plpgsql security invoker
set search_path to 'public','pg_temp'
as $$
declare changed public.library_items;
begin
  update public.library_items set archived_at=coalesce(archived_at,now()) where id=target_item_id returning * into changed;
  if changed.id is null then raise exception 'Library item not found.'; end if;
  return changed;
end $$;

create or replace function public.restore_library_item(target_item_id uuid)
returns public.library_items language plpgsql security invoker
set search_path to 'public','pg_temp'
as $$
declare changed public.library_items;
begin
  update public.library_items set archived_at=null where id=target_item_id returning * into changed;
  if changed.id is null then raise exception 'Library item not found.'; end if;
  return changed;
end $$;

create or replace function public.delete_unused_library_item(target_item_id uuid)
returns boolean language plpgsql security invoker
set search_path to 'public','pg_temp'
as $$
begin
  if exists(select 1 from public.slides where main_library_item_id=target_item_id or reference_library_item_id=target_item_id)
    or exists(select 1 from public.slide_asset_assignments where library_item_id=target_item_id and active) then
    raise exception 'This library item is assigned to one or more slides.';
  end if;
  delete from public.library_items where id=target_item_id;
  return true;
end $$;

grant execute on function public.get_library_item_usage(uuid) to authenticated;
grant execute on function public.archive_library_item(uuid) to authenticated;
grant execute on function public.restore_library_item(uuid) to authenticated;
grant execute on function public.delete_unused_library_item(uuid) to authenticated;

create policy library_files_read on storage.objects for select to authenticated
  using (bucket_id='project-files' and split_part(name,'/',1)='library' and private.has_ladytin_shared_access());
create policy library_files_insert on storage.objects for insert to authenticated
  with check (bucket_id='project-files' and split_part(name,'/',1)='library' and private.has_ladytin_shared_access());
create policy library_files_update on storage.objects for update to authenticated
  using (bucket_id='project-files' and split_part(name,'/',1)='library' and private.has_ladytin_shared_access())
  with check (bucket_id='project-files' and split_part(name,'/',1)='library' and private.has_ladytin_shared_access());
create policy library_files_delete on storage.objects for delete to authenticated
  using (bucket_id='project-files' and split_part(name,'/',1)='library' and private.has_ladytin_shared_access());

do $realtime$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='library_items') then alter publication supabase_realtime add table public.library_items; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='library_collections') then alter publication supabase_realtime add table public.library_collections; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='library_collection_items') then alter publication supabase_realtime add table public.library_collection_items; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='library_item_tags') then alter publication supabase_realtime add table public.library_item_tags; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='slide_asset_assignments') then alter publication supabase_realtime add table public.slide_asset_assignments; end if;
end $realtime$;
