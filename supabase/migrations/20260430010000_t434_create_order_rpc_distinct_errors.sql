-- =============================================================================
-- TerrOir — T-434 : SQLSTATE 23514 wordings UX différenciés
-- =============================================================================
-- Audit #2 finding T-434 [MOYEN]. La RPC create_order_with_items lance 4 raises
-- USING errcode = '23514' indistincts côté front : le client reçoit le message
-- RPC brut (avec UUIDs exposés, ex. "Stock insuffisant pour <uuid>"). Pas de
-- discriminator structuré pour permettre une UX riche (highlight produit
-- fautif, suggestion slot alternatif, etc.).
--
-- Pattern adopté : RAISE ... USING errcode = '23514', HINT = '<discriminator>',
-- DETAIL = '<key=value;...>' (PostgreSQL natif, exposé par Supabase JS via
-- error.hint et error.details). 4 hints distincts :
--   - slot_invalid               : slot inexistant, fermé (active=false), ou
--                                  excluded — combinés en variante 1 actée
--                                  Romain (variante 2 split = chantier futur)
--   - slot_full                  : capacité atteinte
--   - product_producer_mismatch  : anomalie technique (sécurité)
--   - stock_depleted             : stock épuisé sur 1 produit
--
-- DETAIL format key=value;... pour permettre parsing structuré côté route TS
-- (ex. "slot_id=<uuid>;capacity=3;taken=3" → highlight UI possible).
--
-- Fenêtre de panne fail-safe symétrique :
--   - Si DB applied avant code : route ancienne ignore hint → comportement
--     actuel préservé (message brut transmis tel quel).
--   - Si code merged avant DB : route lit error.hint = null → fallback
--     rpcError.message brut. Pas de régression.
--
-- Miroir EXACT de la dernière version (migration 20260423130000_prevent_self_
-- ordering.sql) pour le reste du corps. Adapte uniquement les 4 raises 23514
-- avec hint/detail. `create or replace function` préserve les GRANT.
-- =============================================================================

begin;

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
  v_order_id         uuid;
  v_total            numeric(10, 2) := 0;
  v_item             jsonb;
  v_product_id       uuid;
  v_quantite         numeric(10, 3);
  v_product          record;
  v_sous_total       numeric(10, 2);
  v_ids              uuid[];
  v_slot_capacity    smallint;
  v_slot_taken       bigint;
  v_producer_owner   uuid;
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

  -- 2bis. Guard anti-achat auto-référentiel (P0001 préservé T-434 hors scope).
  select user_id
    into v_producer_owner
  from public.producers
  where id = p_producer_id;

  if v_producer_owner = p_consumer_id then
    raise exception 'Un producteur ne peut pas commander son propre produit'
      using errcode = 'P0001';
  end if;

  -- 3. Slot valide + verrou FOR UPDATE + check capacité.
  --    T-434 : raise 23514 avec hint='slot_invalid' (combine inexistant/fermé/excluded).
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
      using errcode = '23514',
            hint    = 'slot_invalid',
            detail  = format('slot_id=%s', p_slot_id);
  end if;

  select count(*)
    into v_slot_taken
  from public.orders
  where slot_id = p_slot_id
    and statut in ('pending', 'confirmed', 'ready');

  -- T-434 : raise 23514 avec hint='slot_full'.
  if v_slot_taken + 1 > v_slot_capacity then
    raise exception 'Slot % complet : % / % réservations actives',
                    p_slot_id, v_slot_taken, v_slot_capacity
      using errcode = '23514',
            hint    = 'slot_full',
            detail  = format('slot_id=%s;capacity=%s;taken=%s',
                             p_slot_id, v_slot_capacity, v_slot_taken);
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

    -- T-434 : raise 23514 avec hint='product_producer_mismatch' (anomalie technique).
    if v_product.producer_id <> p_producer_id then
      raise exception 'Produit % appartient à un autre producteur', v_product_id
        using errcode = '23514',
              hint    = 'product_producer_mismatch',
              detail  = format('product_id=%s', v_product_id);
    end if;

    -- T-434 : raise 23514 avec hint='stock_depleted'.
    if not v_product.stock_illimite
       and v_product.stock_disponible < v_quantite then
      raise exception 'Stock insuffisant pour %', v_product_id
        using errcode = '23514',
              hint    = 'stock_depleted',
              detail  = format('product_id=%s', v_product_id);
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
