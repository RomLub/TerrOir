-- =============================================================================
-- TerrOir - Product/slot pickup availability model
-- =============================================================================
-- Foundation-only migration. No checkout, cart or public UX is wired here.
--
-- Compatibility strategy:
--   * Existing products get products.pickup_availability_mode =
--     'all_shared_slots' through a NOT NULL default.
--   * Existing slots and slot_rules get availability_scope = 'shared' through
--     NOT NULL defaults.
--   * With no rows in product_slot_availabilities, the current behavior is
--     preserved: an active product is compatible with every active shared slot
--     of the same producer.
--
-- Future behavior prepared:
--   * product mode 'selected_slots' limits a product to explicit slot links.
--   * slot scope 'product_restricted' reserves a slot to explicitly linked
--     products only.
--   * slot_rules.availability_scope lets future recurrent slots inherit the
--     same scope when generated.
-- =============================================================================

begin;

-- 1. Product-level mode --------------------------------------------------------
alter table public.products
  add column if not exists pickup_availability_mode text not null default 'all_shared_slots';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_pickup_availability_mode_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_pickup_availability_mode_check
      check (pickup_availability_mode in ('all_shared_slots', 'selected_slots'));
  end if;
end $$;

comment on column public.products.pickup_availability_mode is
  'Controls pickup slot compatibility. all_shared_slots = current behavior: '
  'available on every shared slot for the producer, plus any explicit reserved '
  'slot links. selected_slots = only explicit links in product_slot_availabilities.';

-- 2. Slot/rule-level scope -----------------------------------------------------
alter table public.slots
  add column if not exists availability_scope text not null default 'shared';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'slots_availability_scope_check'
      and conrelid = 'public.slots'::regclass
  ) then
    alter table public.slots
      add constraint slots_availability_scope_check
      check (availability_scope in ('shared', 'product_restricted'));
  end if;
end $$;

comment on column public.slots.availability_scope is
  'shared = slot available to products using all_shared_slots. '
  'product_restricted = slot available only to products explicitly linked in '
  'product_slot_availabilities.';

alter table public.slot_rules
  add column if not exists availability_scope text not null default 'shared';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'slot_rules_availability_scope_check'
      and conrelid = 'public.slot_rules'::regclass
  ) then
    alter table public.slot_rules
      add constraint slot_rules_availability_scope_check
      check (availability_scope in ('shared', 'product_restricted'));
  end if;
end $$;

comment on column public.slot_rules.availability_scope is
  'Scope inherited by slots materialized from the rule. Defaults to shared for '
  'full backward compatibility.';

-- 3. Explicit product/slot links ----------------------------------------------
create table if not exists public.product_slot_availabilities (
  product_id  uuid not null references public.products(id) on delete cascade,
  slot_id     uuid not null references public.slots(id) on delete cascade,
  producer_id uuid not null references public.producers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (product_id, slot_id)
);

comment on table public.product_slot_availabilities is
  'Explicit compatibility links between products and pickup slots. Used for '
  'selected_slots products and product_restricted slots.';

comment on column public.product_slot_availabilities.producer_id is
  'Denormalized for RLS and fast producer-scoped reads. Maintained and checked '
  'by product_slot_availabilities_set_producer_id().';

create index if not exists product_slot_availabilities_producer_product_idx
  on public.product_slot_availabilities (producer_id, product_id);

create index if not exists product_slot_availabilities_producer_slot_idx
  on public.product_slot_availabilities (producer_id, slot_id);

-- Keep producer_id canonical and reject cross-producer links.
create or replace function public.product_slot_availabilities_set_producer_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_producer_id uuid;
  v_slot_producer_id uuid;
begin
  select producer_id
    into v_product_producer_id
  from public.products
  where id = new.product_id;

  if v_product_producer_id is null then
    raise exception 'Product % introuvable', new.product_id
      using errcode = '23503';
  end if;

  select producer_id
    into v_slot_producer_id
  from public.slots
  where id = new.slot_id;

  if v_slot_producer_id is null then
    raise exception 'Slot % introuvable', new.slot_id
      using errcode = '23503';
  end if;

  if v_product_producer_id is distinct from v_slot_producer_id then
    raise exception 'Product % and slot % belong to different producers',
                    new.product_id, new.slot_id
      using errcode = '23514',
            hint    = 'product_slot_producer_mismatch',
            detail  = format(
              'product_id=%s;slot_id=%s',
              new.product_id,
              new.slot_id
            );
  end if;

  new.producer_id := v_product_producer_id;
  return new;
end;
$$;

drop trigger if exists product_slot_availabilities_set_producer_id
  on public.product_slot_availabilities;
create trigger product_slot_availabilities_set_producer_id
  before insert or update of product_id, slot_id, producer_id
  on public.product_slot_availabilities
  for each row execute function public.product_slot_availabilities_set_producer_id();

alter table public.product_slot_availabilities enable row level security;

drop policy if exists "product_slot_availabilities public read when producer public"
  on public.product_slot_availabilities;
create policy "product_slot_availabilities public read when producer public"
  on public.product_slot_availabilities for select
  using ((select public.is_producer_public(producer_id)));

drop policy if exists "product_slot_availabilities owner all"
  on public.product_slot_availabilities;
create policy "product_slot_availabilities owner all"
  on public.product_slot_availabilities for all
  using ((select public.owns_producer(producer_id)))
  with check ((select public.owns_producer(producer_id)));

drop policy if exists "product_slot_availabilities admin all"
  on public.product_slot_availabilities;
create policy "product_slot_availabilities admin all"
  on public.product_slot_availabilities for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 4. SQL helper for future checkout validation --------------------------------
create or replace function public.is_product_available_on_slot(
  p_product_id uuid,
  p_slot_id uuid
) returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_product record;
  v_slot record;
  v_has_explicit_link boolean;
begin
  select id,
         producer_id,
         coalesce(active, false) as active,
         coalesce(pickup_availability_mode, 'all_shared_slots') as pickup_availability_mode
    into v_product
  from public.products
  where id = p_product_id;

  if not found then
    return false;
  end if;

  select id,
         producer_id,
         coalesce(active, false) as active,
         excluded_at,
         coalesce(availability_scope, 'shared') as availability_scope
    into v_slot
  from public.slots
  where id = p_slot_id;

  if not found then
    return false;
  end if;

  if v_product.producer_id is null
     or v_slot.producer_id is null
     or v_product.producer_id is distinct from v_slot.producer_id then
    return false;
  end if;

  if not v_product.active
     or not v_slot.active
     or v_slot.excluded_at is not null then
    return false;
  end if;

  select exists (
    select 1
    from public.product_slot_availabilities psa
    where psa.product_id = p_product_id
      and psa.slot_id = p_slot_id
  ) into v_has_explicit_link;

  if v_slot.availability_scope = 'product_restricted' then
    return v_has_explicit_link;
  end if;

  if v_product.pickup_availability_mode = 'selected_slots' then
    return v_has_explicit_link;
  end if;

  return true;
end;
$$;

grant execute on function public.is_product_available_on_slot(uuid, uuid)
  to anon, authenticated, service_role;

comment on function public.is_product_available_on_slot(uuid, uuid) is
  'Foundation helper for future checkout validation. Preserves legacy behavior: '
  'all_shared_slots products are available on shared active slots of the same '
  'producer unless the slot is product_restricted.';

commit;
