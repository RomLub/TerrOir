-- =============================================================================
-- TerrOir — T-438 [DETTE COSMÉTIQUE] : re-create RPCs avec encoding UTF-8 propre
-- =============================================================================
-- Audit #2 finding T-438. Lors de l'application Dashboard Supabase de T-413
-- (rename `cancellation_reason` → `closure_reason`) puis T-434 (distinct hints
-- SQLSTATE 23514), les commentaires SQL et messages accentués ont été
-- corrompus à cause du copy-paste PowerShell Windows → Dashboard SQL Editor
-- (encoding cp1252 vers UTF-8, mojibake latin1 sur les caractères accentués).
--
-- Le repo source `.sql` est intact (UTF-8 propre, vérifié file -i charset=utf-8
-- + grep des séquences mojibake latin1 = 0). Cette migration recreate verbatim
-- les 2 RPCs concernées pour aligner l'encoding prod sur le repo.
--
-- Stratégie d'application Dashboard pour préserver UTF-8 :
--   ❌ NE PAS utiliser `cat file.sql` PowerShell (cp1252 → mojibake récursif)
--   ✅ Méthode recommandée : copy depuis GitHub PR "Files changed" → "View file"
--      (UTF-8 garanti). OU VS Code → Dashboard (UTF-8 natif clipboard UTF-16).
--      OU PowerShell `Get-Content -Encoding UTF8 file.sql | Set-Clipboard`.
--
-- Fail-safe symétrique : sémantique fonctionnelle 100% préservée. Aucun
-- changement de signature, aucun changement de comportement, juste re-encoding
-- des commentaires + 3 raise messages accentués (`réservations actives`,
-- `Quantité invalide`, `appartient à un autre producteur`). Ordre code/Dashboard
-- flexible, pas de fenêtre de panne.
--
-- Affecte :
--   - 1 RPC recreate intégrale (revive_order_with_stock_check, T-413 verbatim)
--   - 1 RPC recreate intégrale (create_order_with_items, T-434 verbatim)
--   - GRANT execute préservé via `create or replace function`
-- =============================================================================

begin;

-- ============================================================================
-- 1. revive_order_with_stock_check (T-413 verbatim, encoding UTF-8 propre)
--    Source : supabase/migrations/20260430000000_t413_rename_cancellation_reason_to_closure_reason.sql
-- ============================================================================

create or replace function public.revive_order_with_stock_check(
  p_order_id uuid
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order         record;
  v_slot_capacity smallint;
  v_slot_taken    bigint;
  v_blocking_id   uuid;
begin
  -- 1. Lock l'order. Sérialise les webhooks rejoués sur la même order :
  --    le 2e appel attendra le commit du 1er puis verra statut='pending'
  --    et raisera le garde-fou défensif (bloc 2). Le caller (webhook
  --    handler) check déjà cancelled+payment_failed avant d'appeler la
  --    RPC, mais on re-vérifie ici au cas où la RPC serait appelée par
  --    autre chose plus tard (ex: route admin manual revival).
  select id, slot_id, statut, closure_reason
    into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % introuvable', p_order_id
      using errcode = 'P0002';
  end if;

  -- 2. Garde-fou défensif : seules les orders cancelled+payment_failed
  --    sont éligibles. Un appel sur autre statut (pending, confirmed,
  --    cancelled+autre_reason, refunded) raise immédiatement.
  if v_order.statut <> 'cancelled'
     or v_order.closure_reason is distinct from 'payment_failed' then
    raise exception 'Order % not eligible for revival (statut=%, reason=%)',
                    p_order_id, v_order.statut, v_order.closure_reason
      using errcode = '22023';
  end if;

  -- 3. Lock slot + check capacité.
  --    Le slot pourrait avoir été supprimé entre temps (slot_rules
  --    re-générés, slot.actif=false, etc.) → blocked_slot.
  select capacity_per_slot
    into v_slot_capacity
  from public.slots
  where id = v_order.slot_id
  for update;

  if not found then
    return 'blocked_slot';
  end if;

  -- COUNT exclut cancelled : la commande qu'on ressuscite est elle-même
  -- cancelled, donc PAS comptée → formule v_slot_taken + 1 > capacity
  -- correcte (symétrique à create_order_with_items ligne 117).
  select count(*)
    into v_slot_taken
  from public.orders
  where slot_id = v_order.slot_id
    and statut in ('pending', 'confirmed', 'ready');

  if v_slot_taken + 1 > v_slot_capacity then
    return 'blocked_slot';
  end if;

  -- 4. Lock multi-products ordonné (anti-deadlock).
  --    Symétrique à create_order_with_items ligne 128-132. ORDER BY id
  --    garantit un ordre stable pour éviter les deadlocks entre 2
  --    transactions concurrentes.
  perform 1
  from public.products p
  where p.id in (
    select distinct product_id
    from public.order_items
    where order_id = p_order_id
  )
  order by p.id
  for update;

  -- 5. Check stock tout-ou-rien.
  --    Un seul item en rupture → blocked_stock global, pas de partial
  --    fulfillment. LIMIT 1 = on n'a pas besoin de la liste exhaustive
  --    des produits en rupture côté SQL ; le caller renverra un email
  --    générique. La metadata détaillée pourra être enrichie via
  --    audit_logs côté webhook si besoin.
  select oi.product_id
    into v_blocking_id
  from public.order_items oi
  inner join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id
    and p.stock_illimite = false
    and p.stock_disponible < oi.quantite
  limit 1;

  if v_blocking_id is not null then
    return 'blocked_stock';
  end if;

  -- 6. Décrémentation atomique du stock pour tous les order_items.
  --    UPDATE FROM correlated subquery : un seul UPDATE pour tous les
  --    products de l'order, plus efficient qu'une boucle FOR. Filtre
  --    stock_illimite = false symétrique à create_order_with_items.
  update public.products p
  set stock_disponible = p.stock_disponible - oi.quantite
  from public.order_items oi
  where oi.order_id = p_order_id
    and oi.product_id = p.id
    and p.stock_illimite = false;

  -- 7. UPDATE order : cancelled → pending + reset reason/cancelled_at.
  --    Préserve l'invariant `cancelled_at IS NULL ⟺ statut ∉
  --    {cancelled, refunded}` (cf P1 commit 49c0f1b).
  --
  --    ⚠️ Bypass volontaire de la state machine (cancelled → pending
  --    n'est pas légal globalement). Cas spécifique de résurrection
  --    3DS-retry, pas une transition générique. Le trigger
  --    orders_restore_stock_after_cancel ne se déclenche PAS sur cette
  --    transition (NEW.statut='pending' n'est pas dans sa clause WHEN
  --    NEW.statut IN ('cancelled', 'refunded')).
  update public.orders
  set statut = 'pending',
      closure_reason = null,
      cancelled_at = null
  where id = p_order_id;

  return 'revived';
end;
$$;

grant execute on function public.revive_order_with_stock_check(uuid)
  to service_role;

-- ============================================================================
-- 2. create_order_with_items (T-434 verbatim, encoding UTF-8 propre)
--    Source : supabase/migrations/20260430010000_t434_create_order_rpc_distinct_errors.sql
-- ============================================================================

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
