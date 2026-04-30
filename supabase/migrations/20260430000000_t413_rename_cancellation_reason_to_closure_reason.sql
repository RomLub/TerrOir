-- =============================================================================
-- TerrOir — T-413 [MINEUR] : rename orders.cancellation_reason → closure_reason
-- =============================================================================
-- Audit #2 finding T-413 — la colonne `cancellation_reason` (créée en
-- 20260419030000_orders_cancellation_reason_and_search.sql) était sémantiquement
-- abusée : elle stocke aussi des raisons de "refund post-completed"
-- ('admin_refund', co-existant avec statut='refunded') et de "résurrection
-- bloquée" ('revival_blocked_stock', 'revival_blocked_slot'), pas seulement
-- des raisons d'annulation pure.
--
-- Décision Option B actée (vs Option D enrich comment seul) : rename complet
-- vers `closure_reason` (terme neutre couvrant les 3 catégories + aligné
-- convention Stripe API qui utilise aussi `closure_reason` sur certains
-- objets). Pas de pansement, on traite la sémantique à la racine.
--
-- ⚠️ NON-RÉTROCOMPATIBLE : appliquer cette migration AVANT le merge code.
-- Fenêtre de panne webhook Stripe ~2-5min entre apply DB et merge code,
-- Stripe retry auto (impact prod nul). Pattern T-426.
--
-- Affecte :
--   - 1 colonne renommée + son index partial
--   - 1 commentaire enrichi (3 catégories + 9 valeurs)
--   - 1 RPC recreate intégrale (revive_order_with_stock_check, 4 références
--     internes : SELECT, IF garde, RAISE interpolation, UPDATE)
--
-- Note : ALTER COLUMN RENAME ne renomme PAS dans le corps des fonctions
-- plpgsql. La RPC revive_order_with_stock_check (créée 20260427300000)
-- doit être recreate intégralement avec le nouveau nom de colonne.
-- =============================================================================

begin;

-- 1. Rename colonne
alter table public.orders
  rename column cancellation_reason to closure_reason;

-- 2. Rename index partial associé (cohérence nommage)
alter index public.orders_cancellation_reason_idx
  rename to orders_closure_reason_idx;

-- 3. Comment enrichi (documente les 3 catégories sémantiques + 9 valeurs)
comment on column public.orders.closure_reason is
  'Raison de cloture/fin d''order. Co-stocke 3 categories de raisons (semantique elargie pre-Audit #2 T-413) :
   - Annulation pure (statut=cancelled) : ''stock'', ''producer_cancel'', ''consumer_cancel'', ''timeout'', ''payment_failed'', ''other''
   - Refund post-completed (statut=refunded) : ''admin_refund''
   - Resurrection bloquee (statut=cancelled, refund Stripe OK) : ''revival_blocked_stock'', ''revival_blocked_slot''';

-- 4. Recreate RPC revive_order_with_stock_check intégrale
--    Corps copié depuis 20260427300000_revive_order_with_stock_check.sql
--    avec les 4 références cancellation_reason → closure_reason :
--      - SELECT (lecture colonne, ligne 77 origine)
--      - IF garde (test valeur, ligne 92 origine)
--      - RAISE interpolation (message d'erreur, ligne 94 origine)
--      - UPDATE (écriture colonne reset, ligne 180 origine)
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

commit;
