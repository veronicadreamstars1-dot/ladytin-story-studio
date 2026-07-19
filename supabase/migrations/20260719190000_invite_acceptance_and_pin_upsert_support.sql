-- Applied to the live project as migration
-- 20260719190000_invite_acceptance_and_pin_upsert_support (via MCP apply_migration).

-- Snapshot import and Pinterest sync upserts rely on the existing unique
-- constraint pinterest_pins_project_id_pinterest_pin_id_key.
-- Covering indexes for the foreign keys these features query.
create index if not exists assets_story_set_id_idx on public.assets(story_set_id);
create index if not exists slides_main_asset_id_idx on public.slides(main_asset_id);
create index if not exists slides_reference_asset_id_idx on public.slides(reference_asset_id);
create index if not exists project_invites_project_id_idx on public.project_invites(project_id);

-- Secure invitation acceptance. Runs as definer because the invited user cannot
-- read project_invites (owner-only RLS) and cannot insert into project_members.
create or replace function public.accept_project_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  invite record;
  caller_id uuid := (select auth.uid());
  caller_email text := lower(coalesce((select auth.jwt()->>'email'),''));
begin
  if caller_id is null then
    raise exception 'You must be signed in to accept an invitation.';
  end if;
  select * into invite from public.project_invites where token=invite_token for update;
  if not found then
    raise exception 'This invitation does not exist.';
  end if;
  if invite.accepted_at is not null then
    raise exception 'This invitation has already been used.';
  end if;
  if invite.expires_at < now() then
    raise exception 'This invitation has expired.';
  end if;
  if lower(invite.email) <> caller_email then
    raise exception 'This invitation was sent to a different email address.';
  end if;
  if invite.role not in ('editor','viewer') then
    raise exception 'This invitation has an invalid role.';
  end if;
  insert into public.project_members(project_id,user_id,role,invited_email)
  values(invite.project_id,caller_id,invite.role,invite.email)
  on conflict (project_id,user_id) do update set invited_email=excluded.invited_email;
  update public.project_invites set accepted_at=now() where id=invite.id;
  return jsonb_build_object('project_id',invite.project_id,'role',invite.role);
end $$;

revoke all on function public.accept_project_invite(text) from public, anon;
grant execute on function public.accept_project_invite(text) to authenticated;
