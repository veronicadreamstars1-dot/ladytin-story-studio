create table if not exists private.app_login_attempts(
  attempt_key text primary key,
  failures integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on private.app_login_attempts from public, anon, authenticated;

create or replace function public.app_login_status(attempt_key text)
returns jsonb language plpgsql security definer set search_path to 'private','pg_temp'
as $$
declare row private.app_login_attempts%rowtype;
begin
  select * into row from private.app_login_attempts where app_login_attempts.attempt_key=app_login_status.attempt_key;
  if not found then return jsonb_build_object('locked',false,'retry_after_seconds',0); end if;
  if row.locked_until is not null and row.locked_until>now() then
    return jsonb_build_object('locked',true,'retry_after_seconds',greatest(1,ceil(extract(epoch from row.locked_until-now()))::integer));
  end if;
  if row.locked_until is not null and row.locked_until<=now() then delete from private.app_login_attempts where app_login_attempts.attempt_key=app_login_status.attempt_key; end if;
  return jsonb_build_object('locked',false,'retry_after_seconds',0);
end $$;
revoke all on function public.app_login_status(text) from public, anon, authenticated;
grant execute on function public.app_login_status(text) to service_role;

create or replace function public.record_app_login_result(attempt_key text,succeeded boolean)
returns jsonb language plpgsql security definer set search_path to 'private','pg_temp'
as $$
declare row private.app_login_attempts%rowtype; next_failures integer; next_lock timestamptz;
begin
  if succeeded then delete from private.app_login_attempts where app_login_attempts.attempt_key=record_app_login_result.attempt_key; return jsonb_build_object('locked',false,'retry_after_seconds',0); end if;
  select * into row from private.app_login_attempts where app_login_attempts.attempt_key=record_app_login_result.attempt_key for update;
  if not found or row.window_started_at<now()-interval '15 minutes' then
    insert into private.app_login_attempts(attempt_key,failures,window_started_at,locked_until,updated_at)
    values(record_app_login_result.attempt_key,1,now(),null,now())
    on conflict on constraint app_login_attempts_pkey do update set failures=1,window_started_at=now(),locked_until=null,updated_at=now();
    return jsonb_build_object('locked',false,'retry_after_seconds',0,'failures',1);
  end if;
  next_failures:=row.failures+1;
  next_lock:=case when next_failures>=5 then now()+interval '15 minutes' else null end;
  update private.app_login_attempts set failures=next_failures,locked_until=next_lock,updated_at=now() where app_login_attempts.attempt_key=record_app_login_result.attempt_key;
  return jsonb_build_object('locked',next_lock is not null,'retry_after_seconds',case when next_lock is null then 0 else 900 end,'failures',next_failures);
end $$;
revoke all on function public.record_app_login_result(text,boolean) from public, anon, authenticated;
grant execute on function public.record_app_login_result(text,boolean) to service_role;
