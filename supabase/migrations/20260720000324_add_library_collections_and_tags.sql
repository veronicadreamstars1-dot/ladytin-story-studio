create table if not exists public.library_collections(
  id uuid primary key default gen_random_uuid(),
  library_type text not null check (library_type in ('reference','media')),
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(library_type,name)
);

create table if not exists public.library_collection_items(
  collection_id uuid not null references public.library_collections(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  sort_order integer not null default 0,
  primary key(collection_id,library_item_id)
);

create table if not exists public.library_tags(
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.library_item_tags(
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  tag_id uuid not null references public.library_tags(id) on delete cascade,
  primary key(library_item_id,tag_id)
);

drop trigger if exists library_collections_touch on public.library_collections;
create trigger library_collections_touch before update on public.library_collections
  for each row execute function private.touch_updated_at();

create index if not exists library_collection_items_collection_id_idx on public.library_collection_items(collection_id);
create index if not exists library_collection_items_library_item_id_idx on public.library_collection_items(library_item_id);
create index if not exists library_item_tags_library_item_id_idx on public.library_item_tags(library_item_id);
create index if not exists library_item_tags_tag_id_idx on public.library_item_tags(tag_id);
