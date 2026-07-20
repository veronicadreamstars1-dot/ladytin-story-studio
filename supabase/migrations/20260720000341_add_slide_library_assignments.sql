alter table public.slides add column if not exists main_library_item_id uuid references public.library_items(id) on delete set null;
alter table public.slides add column if not exists reference_library_item_id uuid references public.library_items(id) on delete set null;
alter table public.slides add column if not exists reference_match_score numeric;
alter table public.slides add column if not exists reference_match_reason text not null default '';

update public.slides
set reference_mode='editorial_direction_only',
    pinterest_pin_id=null,
    pinterest_match_score=null,
    pinterest_match_reason=''
where reference_mode in ('pinterest_auto','pinterest_selected');

alter table public.slides drop constraint if exists slides_reference_mode_check;
alter table public.slides add constraint slides_reference_mode_check
  check (reference_mode in ('library_reference','manual_upload','editorial_direction_only'));

create index if not exists slides_main_library_item_id_idx on public.slides(main_library_item_id);
create index if not exists slides_reference_library_item_id_idx on public.slides(reference_library_item_id);

create table if not exists public.slide_asset_assignments(
  id uuid primary key default gen_random_uuid(),
  slide_id uuid not null references public.slides(id) on delete cascade,
  library_item_id uuid references public.library_items(id) on delete set null,
  assignment_role text not null check (assignment_role in ('main_asset','reference','logo')),
  source_type text not null check (source_type in ('library','manual_upload','editorial_direction')),
  manual_asset_id uuid references public.assets(id) on delete set null,
  assignment_metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slide_asset_assignments_has_source check (
    (source_type='library' and library_item_id is not null)
    or (source_type='manual_upload' and manual_asset_id is not null)
    or (source_type='editorial_direction' and library_item_id is null and manual_asset_id is null)
  )
);

drop trigger if exists slide_asset_assignments_touch on public.slide_asset_assignments;
create trigger slide_asset_assignments_touch before update on public.slide_asset_assignments
  for each row execute function private.touch_updated_at();

create unique index if not exists slide_asset_assignments_one_active_role_idx
  on public.slide_asset_assignments(slide_id,assignment_role)
  where active;
create index if not exists slide_asset_assignments_slide_id_idx on public.slide_asset_assignments(slide_id);
create index if not exists slide_asset_assignments_library_item_id_idx on public.slide_asset_assignments(library_item_id);
create index if not exists slide_asset_assignments_manual_asset_id_idx on public.slide_asset_assignments(manual_asset_id);
