-- =============================================================================
-- TerrOir — Guard anti-achat auto-référentiel dans create_order_with_items
-- =============================================================================
-- Défense en profondeur : un producer connecté ne doit pas pouvoir commander
-- son propre produit. Deux couches de protection dans le chantier :
--
--   1. UI consumer : bouton "Ajouter au panier" désactivé + label "Votre
--      produit" (cf ProductPageClient.tsx, commit séparé du même chantier).
--   2. RPC create_order_with_items (cette migration) : raise P0001 si
--      p_consumer_id correspond au user_id du producer ciblé. Garde-fou
--      ultime — la RPC est le point de passage obligé pour toute création
--      d'order, donc le check ici couvre aussi un éventuel appel direct qui
--      contournerait l'UI.
--
-- Guard injecté en **bloc 2bis** (juste après le check "producer public",
-- avant le check slot) :
--   - une seule lecture DB supplémentaire (lookup user_id sur producers) ;
--   - zéro surcoût dans la boucle items (bloc 5 reste inchangé) ;
--   - détecté tôt → pas de verrou FOR UPDATE inutile sur slot/products.
--
-- SQLSTATE P0001 (raise_exception applicatif) — distinct de :
--   - 23514 (violations contraintes métier : stock, slot complet),
--   - 42501 (auth / permission),
--   - 22023 (input invalide).
-- Le mapping HTTP côté API route.ts peut facilement ajouter P0001 → 403.
--
-- Miroir exact de la dernière version (migration 20260423000000, bloc 5
-- utilisant products.active) pour le reste du corps. `create or replace`
-- préserve les GRANT (anon, authenticated) posés en 20260419040000.
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

  -- 2bis. Guard anti-achat auto-référentiel.
  -- Le producer ne peut pas être son propre consumer. On lit user_id sur la
  -- ligne producers ciblée et on compare à p_consumer_id (qui vaut déjà
  -- auth.uid() après bloc 0). Lookup O(1) sur PK indexé.
  select user_id
    into v_producer_owner
  from public.producers
  where id = p_producer_id;

  if v_producer_owner = p_consumer_id then
    raise exception 'Un producteur ne peut pas commander son propre produit'
      using errcode = 'P0001';
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
