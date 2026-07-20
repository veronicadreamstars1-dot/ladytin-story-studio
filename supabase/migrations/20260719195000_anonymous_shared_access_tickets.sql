create table if not exists private.app_access_tickets(
  ticket_hash text primary key,
  attempt_key text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
revoke all on private.app_access_tickets from public, anon, authenticated;

create or replace function public.create_app_access_ticket(ticket_hash text,attempt_key text,expires_in_seconds integer default 120)
returns void language plpgsql security definer set search_path to 'private','pg_temp'
as $$
begin
  delete from private.app_access_tickets where expires_at<now()-interval '1 hour' or used_at is not null;
  insert into private.app_access_tickets(ticket_hash,attempt_key,expires_at)
  values(create_app_access_ticket.ticket_hash,create_app_access_ticket.attempt_key,now()+make_interval(secs=>greatest(30,least(expires_in_seconds,300))));
end $$;
revoke all on function public.create_app_access_ticket(text,text,integer) from public, anon, authenticated;
grant execute on function public.create_app_access_ticket(text,text,integer) to service_role;

create or replace function public.consume_app_access_ticket(ticket_hash text)
returns boolean language plpgsql security definer set search_path to 'private','pg_temp'
as $$
declare ticket private.app_access_tickets%rowtype;
begin
  select * into ticket from private.app_access_tickets where app_access_tickets.ticket_hash=consume_app_access_ticket.ticket_hash for update;
  if not found or ticket.used_at is not null or ticket.expires_at<=now() then return false; end if;
  update private.app_access_tickets set used_at=now() where app_access_tickets.ticket_hash=consume_app_access_ticket.ticket_hash;
  return true;
end $$;
revoke all on function public.consume_app_access_ticket(text) from public, anon, authenticated;
grant execute on function public.consume_app_access_ticket(text) to service_role;
