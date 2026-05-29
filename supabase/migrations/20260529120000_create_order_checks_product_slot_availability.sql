-- =============================================================================
-- TerrOir - create_order_with_items product/slot availability guard
-- =============================================================================
-- Forward-only checkout wiring for the product <-> slot availability model.
-- The browser and API can pre-check, but this RPC remains the final source of
-- truth: a forged request cannot create an order on an incompatible slot.
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
  v_slot_date        date;
begin
  -- 0. Auth
  if auth.uid() is null or p_consumer_id is distinct from auth.uid() then
    raise exception 'Consumer mismatch with auth.uid()'
      using errcode = '42501';
  end if;

  -- 1. Input validation
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array'
      using errcode = '22023';
  end if;

  -- 2. Public producer only
  if not exists (
    select 1 from public.producers
    where id = p_producer_id and statut = 'public'
  ) then
    raise exception 'Producer % is not public', p_producer_id
      using errcode = '42501';
  end if;

  -- 2bis. Producers cannot buy from themselves.
  select user_id
    into v_producer_owner
  from public.producers
  where id = p_producer_id;

  if v_producer_owner = p_consumer_id then
    raise exception 'Vous ne pouvez pas commander vos propres produits.'
      using errcode = 'P0001';
  end if;

  -- 3. Valid slot + row lock + capacity check.
  select capacity_per_slot,
         (starts_at at time zone 'Europe/Paris')::date
    into v_slot_capacity,
         v_slot_date
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

  -- 3bis. Producer unavailability guard.
  if exists (
    select 1 from public.unavailabilities
    where producer_id = p_producer_id
      and date = v_slot_date
  ) then
    raise exception 'Producteur indisponible le %', v_slot_date
      using errcode = '23514',
            hint    = 'slot_unavailable',
            detail  = format('slot_id=%s;date=%s', p_slot_id, v_slot_date);
  end if;

  select count(*)
    into v_slot_taken
  from public.orders
  where slot_id = p_slot_id
    and statut in ('pending', 'confirmed');

  if v_slot_taken + 1 > v_slot_capacity then
    raise exception 'Slot % complet : % / % reservations actives',
                    p_slot_id, v_slot_taken, v_slot_capacity
      using errcode = '23514',
            hint    = 'slot_full',
            detail  = format('slot_id=%s;capacity=%s;taken=%s',
                             p_slot_id, v_slot_capacity, v_slot_taken);
  end if;

  -- 4. Stable product lock order.
  select array_agg(distinct (item->>'product_id')::uuid order by (item->>'product_id')::uuid)
    into v_ids
  from jsonb_array_elements(p_items) as item;

  perform 1
  from public.products
  where id = any(v_ids)
  order by id
  for update;

  -- 5. Per-line validation + DB-authoritative price total.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantite   := (v_item->>'quantite')::numeric(10, 3);

    if v_quantite is null or v_quantite <= 0 then
      raise exception 'Quantite invalide pour le produit %', v_product_id
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
      raise exception 'Produit % appartient a un autre producteur', v_product_id
        using errcode = '23514',
              hint    = 'product_producer_mismatch',
              detail  = format('product_id=%s', v_product_id);
    end if;

    if not public.is_product_available_on_slot(v_product_id, p_slot_id) then
      raise exception 'Produit % indisponible sur le creneau %',
                      v_product_id, p_slot_id
        using errcode = '23514',
              hint    = 'product_slot_unavailable',
              detail  = format('product_id=%s;slot_id=%s',
                               v_product_id, p_slot_id);
    end if;

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

  -- 6. Insert order. Existing triggers compute code/order numbers/amount splits.
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

  -- 7. Insert order_items + decrement finite stock.
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
