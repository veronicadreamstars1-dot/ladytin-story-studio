create table if not exists private.app_access_config(
  singleton boolean primary key default true check(singleton),
  password_hash text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.app_access_config from public, anon, authenticated;

create or replace function public.verify_app_access_password(candidate text)
returns boolean language sql stable security definer
set search_path to 'private','extensions','pg_temp'
as $$
  select coalesce((select extensions.crypt(candidate,password_hash)=password_hash from private.app_access_config where singleton=true),false)
$$;
revoke all on function public.verify_app_access_password(text) from public, anon, authenticated;
grant execute on function public.verify_app_access_password(text) to service_role;

comment on table private.app_access_config is 'Stores only a one-way verifier for shared application access. The raw password is never stored.';
