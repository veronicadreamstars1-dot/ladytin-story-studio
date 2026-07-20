create or replace function public.consume_app_access_ticket(p_ticket text)
returns boolean language plpgsql security definer set search_path to 'private','pg_temp'
as $$
declare ticket private.app_access_tickets%rowtype;
begin
  select *
  into ticket
  from private.app_access_tickets
  where app_access_tickets.ticket_hash=p_ticket
  for update;

  if not found or ticket.used_at is not null or ticket.expires_at<=now() then
    return false;
  end if;

  update private.app_access_tickets
  set used_at=now()
  where app_access_tickets.ticket_hash=p_ticket;

  return true;
end $$;

revoke all on function public.consume_app_access_ticket(text) from public, anon, authenticated;
grant execute on function public.consume_app_access_ticket(text) to service_role;
