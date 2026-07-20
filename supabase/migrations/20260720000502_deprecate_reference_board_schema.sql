comment on table public.pinterest_connections is 'Deprecated legacy reference-board credential table. Retained temporarily to avoid destroying historical data; active app no longer reads or writes it.';
comment on table public.pinterest_pins is 'Deprecated legacy reference-board metadata cache. Retained temporarily to avoid destroying historical data; active app no longer reads or writes it.';
comment on table public.pinterest_recommendations is 'Deprecated legacy reference-board recommendation cache. Retained temporarily for safe future cleanup.';

revoke all on public.pinterest_connections from anon, authenticated;

update public.slides
set reference_mode='editorial_direction_only',
    pinterest_pin_id=null,
    pinterest_match_score=null,
    pinterest_match_reason=''
where reference_mode in ('pinterest_auto','pinterest_selected')
   or pinterest_pin_id is not null;
