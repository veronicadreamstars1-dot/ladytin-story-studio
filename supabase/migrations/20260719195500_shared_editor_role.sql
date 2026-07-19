create or replace function private.project_role(target_project_id uuid)
returns text language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select case
    when coalesce((auth.jwt()->'app_metadata'->>'ladytin_shared_access')::boolean,false)
      and coalesce((auth.jwt()->'app_metadata'->>'ladytin_shared_access_expires_at')::timestamptz,'epoch'::timestamptz)>now()
      then 'editor'
    else(
      select role from public.project_members
      where project_id=target_project_id and user_id=(select auth.uid())
      limit 1
    )
  end
$$;

drop policy if exists projects_delete_owner on public.projects;
drop policy if exists projects_delete_shared_editors on public.projects;
create policy projects_delete_shared_editors on public.projects for delete to authenticated
  using(private.project_role(id) in('owner','editor'));
