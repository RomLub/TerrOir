-- =============================================================================
-- TerrOir — Rename products.actif → products.active (dette technique)
-- =============================================================================
-- Symétrique au rename slots.actif → slots.active livré la veille (migration
-- 20260422700000). Le reste du schéma utilise l'anglais pour les booléens
-- techniques (slots.active, slot_rules.active, stock_illimite, …) — seule
-- products.actif restait en français sur les tables principales.
--
-- Périmètre :
--   1. alter table public.products rename column actif to active;
--   2. rename index products_actif_idx → products_active_idx
--      (créé en 20260419000000, jamais droppé depuis).
--   3. recreate RLS policy "products public read when producer public"
--      (dernière version : 20260422000000) avec active = true
--   4. recreate public.search_producers — miroir exact 20260422000000,
--      seule la ligne `pr.actif = true` du sous-select product_count
--      devient `pr.active = true`.
--   5. recreate public.create_order_with_items — miroir exact de la dernière
--      version (20260422700000). Deux lignes changent : le SELECT qui lit
--      `actif` dans v_product (bloc 5) et le test `if not v_product.actif`.
--
-- Idempotence : blocs DO pour rename column + rename index (no-op si déjà
-- migré). `create or replace function` préserve les GRANT ; la policy est
-- droppée avant recreation.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Rename column
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'actif'
  ) then
    alter table public.products rename column actif to active;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Rename index products_actif_idx → products_active_idx
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'products_actif_idx'
  ) then
    alter index public.products_actif_idx rename to products_active_idx;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. RLS policy products public read : active = true
-- -----------------------------------------------------------------------------
drop policy if exists "products public read when producer public" on public.products;

create policy "products public read when producer public"
  on public.products for select
  using (
    active = true
    and exists (
      select 1 from public.producers p
      where p.id = products.producer_id and p.statut = 'public'
    )
  );

-- -----------------------------------------------------------------------------
-- 4. RPC search_producers : pr.active = true dans product_count
-- -----------------------------------------------------------------------------
-- Miroir exact de migration 20260422000000 (où p.statut = 'public' a remplacé
-- 'active' dans la clause WHERE). Seule différence : `pr.actif` → `pr.active`
-- dans le sous-select product_count. Signature inchangée → create or replace
-- préserve les GRANT (anon, authenticated) posés en 20260421000000.
create or replace function public.search_producers(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_km  double precision,
  p_especes    text[] default null,
  p_labels     text[] default null
)
returns table (
  id                         uuid,
  slug                       text,
  nom_exploitation           text,
  commune                    text,
  code_postal                text,
  latitude                   double precision,
  longitude                  double precision,
  photo_principale           text,
  especes                    text[],
  labels                     text[],
  badge_stock_score          double precision,
  badge_confirmation_score   double precision,
  badge_annulation_score     double precision,
  distance_km                double precision,
  note_moyenne               numeric,
  nb_avis                    int,
  product_count              int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id, p.slug, p.nom_exploitation, p.commune, p.code_postal,
    p.latitude, p.longitude, p.photo_principale, p.especes, p.labels,
    p.badge_stock_score, p.badge_confirmation_score, p.badge_annulation_score,
    (6371 * acos(
      greatest(-1, least(1,
        cos(radians(p_lat)) * cos(radians(p.latitude))
        * cos(radians(p.longitude) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(p.latitude))
      ))
    )) as distance_km,
    p.note_moyenne::numeric as note_moyenne,
    p.nb_avis               as nb_avis,
    (
      select count(*)::int
      from public.products pr
      where pr.producer_id = p.id
        and pr.active = true
    ) as product_count
  from public.producers p
  where p.statut = 'public'
    and p.latitude  is not null
    and p.longitude is not null
    and (
      p_especes is null
      or array_length(p_especes, 1) is null
      or p.especes && p_especes
    )
    and (
      p_labels is null
      or array_length(p_labels, 1) is null
      or p.labels && p_labels
    )
    and (6371 * acos(
      greatest(-1, least(1,
        cos(radians(p_lat)) * cos(radians(p.latitude))
        * cos(radians(p.longitude) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(p.latitude))
      ))
    )) <= p_radius_km
  order by distance_km;
$$;

-- -----------------------------------------------------------------------------
-- 5. RPC create_order_with_items : products.active dans bloc 5
-- -----------------------------------------------------------------------------
-- Miroir exact de migration 20260422700000. Seules les lignes qui lisent
-- products.actif changent : le SELECT returning `actif` (désormais `active`)
-- et le test `if not v_product.actif then` (désormais `v_product.active`).
-- Le check slot `active = true` (bloc 3) a déjà été mis à jour la veille.
create or replace function public.create_order_with_items(
  p_consumer_id    uuid,
  p_producer_id    uuid,
  p_slot_id        uuid,
  p_date_retrait   date,
  p_heure_retrait  time,
  p_notes_client   text,
  p_items          jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id       uuid;
  v_total          numeric(10, 2) := 0;
  v_item           jsonb;
  v_product_id     uuid;
  v_quantite       numeric(10, 3);
  v_product        record;
  v_sous_total     numeric(10, 2);
  v_ids            uuid[];
  v_slot_capacity  smallint;
  v_slot_taken     bigint;
begin
  -- 0. Auth
  if auth.uid() is null or p_consumer_id is distinct from auth.uid() then
    raise exception 'Consumer mismatch with auth.uid()'
      using errcode = '42501';
  end if;

  -- 1. Validation input
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array'
      using errcode = '22023';
  end if;

  -- 2. Producteur vitrine ('public') ?
  if not exists (
    select 1 from public.producers
    where id = p_producer_id and statut = 'public'
  ) then
    raise exception 'Producer % is not public', p_producer_id
      using errcode = '42501';
  end if;

  -- 3. Slot valide + verrou FOR UPDATE + check capacité.
  select capacity_per_slot
    into v_slot_capacity
  from public.slots
  where id = p_slot_id
    and producer_id = p_producer_id
    and active = true
    and excluded_at is null
  for update;

  if not found then
    raise exception 'Slot % invalide pour ce producteur', p_slot_id
      using errcode = '23514';
  end if;

  select count(*)
    into v_slot_taken
  from public.orders
  where slot_id = p_slot_id
    and statut in ('pending', 'confirmed', 'ready');

  if v_slot_taken + 1 > v_slot_capacity then
    raise exception 'Slot % complet : % / % réservations actives',
                    p_slot_id, v_slot_taken, v_slot_capacity
      using errcode = '23514';
  end if;

  -- 4. Collecte des IDs produits (dédupliqués) + verrou FOR UPDATE stable
  select array_agg(distinct (item->>'product_id')::uuid order by (item->>'product_id')::uuid)
    into v_ids
  from jsonb_array_elements(p_items) as item;

  perform 1
  from public.products
  where id = any(v_ids)
  order by id
  for update;

  -- 5. Validation ligne par ligne + calcul du total (prix DB autoritatif)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantite   := (v_item->>'quantite')::numeric(10, 3);

    if v_quantite is null or v_quantite <= 0 then
      raise exception 'Quantité invalide pour le produit %', v_product_id
        using errcode = '22023';
    end if;

    select id, producer_id, prix, stock_disponible, stock_illimite, active
      into v_product
    from public.products
    where id = v_product_id;

    if not found then
      raise exception 'Produit % introuvable', v_product_id
        using errcode = 'P0002';
    end if;
    if not v_product.active then
      raise exception 'Produit % inactif', v_product_id
        using errcode = '42501';
    end if;
    if v_product.producer_id <> p_producer_id then
      raise exception 'Produit % appartient à un autre producteur', v_product_id
        using errcode = '23514';
    end if;
    if not v_product.stock_illimite
       and v_product.stock_disponible < v_quantite then
      raise exception 'Stock insuffisant pour %', v_product_id
        using errcode = '23514';
    end if;

    v_sous_total := round(v_product.prix * v_quantite, 2);
    v_total := v_total + v_sous_total;
  end loop;

  -- 6. Insert order (triggers DB calculent code_commande / commission / net)
  insert into public.orders (
    consumer_id, producer_id, slot_id,
    date_retrait, heure_retrait, notes_client,
    montant_total, statut
  )
  values (
    p_consumer_id, p_producer_id, p_slot_id,
    p_date_retrait, p_heure_retrait, p_notes_client,
    v_total, 'pending'
  )
  returning id into v_order_id;

  -- 7. Insert order_items + décrément stock
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantite   := (v_item->>'quantite')::numeric(10, 3);

    select prix, stock_illimite
      into v_product
    from public.products
    where id = v_product_id;

    v_sous_total := round(v_product.prix * v_quantite, 2);

    insert into public.order_items (
      order_id, product_id, quantite, prix_unitaire, sous_total
    )
    values (
      v_order_id, v_product_id, v_quantite, v_product.prix, v_sous_total
    );

    if not v_product.stock_illimite then
      update public.products
      set stock_disponible = stock_disponible - v_quantite
      where id = v_product_id;
    end if;
  end loop;

  return v_order_id;
end;
$$;

commit;
