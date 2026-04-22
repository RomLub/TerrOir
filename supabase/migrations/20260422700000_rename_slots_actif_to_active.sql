-- =============================================================================
-- TerrOir — Rename slots.actif → slots.active (dette technique)
-- =============================================================================
-- Le reste du modèle créneaux utilise des termes anglais (slot_rules.active,
-- slots.capacity_per_slot, slots.starts_at, ...). Seule slots.actif restait
-- en français par héritage du schema initial (migration 20260419000000).
-- Le renommage avait été volontairement différé à la Phase 6 du chantier
-- créneaux (cf note en en-tête de migration 20260422300000) pour ne pas
-- désynchroniser la RPC create_order_with_items entre deux apply.
--
-- Périmètre :
--   1. alter table public.slots rename column actif to active;
--   2. recreate public.create_order_with_items avec `active = true`
--      (miroir exact de migration 20260422500000, seule la ligne 82 change).
--
-- Aucune policy RLS ne référence slots.actif (vérifié : policies
-- "slots public read when producer public" et "slots owner all" filtrent
-- sur producer_id / statut du producer, jamais sur slots.actif). L'index
-- original `slots_producer_id_idx` a été droppé en Phase 1 (migration
-- 20260422300000) au profit de (producer_id, starts_at), donc pas d'index
-- sur actif à recréer.
--
-- Idempotence : bloc DO qui vérifie l'existence de la colonne avant rename.
-- Sur une DB déjà migrée, le re-run est no-op. `create or replace function`
-- préserve les GRANT de la RPC.
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
      and table_name = 'slots'
      and column_name = 'actif'
  ) then
    alter table public.slots rename column actif to active;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. RPC create_order_with_items : ligne 82 `active = true`
-- -----------------------------------------------------------------------------
-- Miroir exact de migration 20260422500000, seule la référence à slots.actif
-- est mise à jour. Les autres blocs (auth, items validation, producer public,
-- capacity check avec FOR UPDATE, stock, commission) sont identiques. Le
-- test `v_product.actif` (ligne 134) reste inchangé car il porte sur
-- products.actif, hors périmètre du rename.
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

    select id, producer_id, prix, stock_disponible, stock_illimite, actif
      into v_product
    from public.products
    where id = v_product_id;

    if not found then
      raise exception 'Produit % introuvable', v_product_id
        using errcode = 'P0002';
    end if;
    if not v_product.actif then
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
