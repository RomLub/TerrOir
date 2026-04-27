-- =============================================================================
-- TerrOir — RPC atomique de résurrection d'order avec check stock + slot
-- =============================================================================
-- Bug détecté en validation prod end-to-end après commit P1 49c0f1b
-- (idempotence retentative paiement après 3DS-fail) : la résurrection
-- cancelled+payment_failed → pending fait un UPDATE direct sans re-décrémenter
-- le stock. La symétrie était cassée :
--   - Décrémentation initiale : RPC create_order_with_items (atomique).
--   - Restauration à l'annulation : trigger DB orders_restore_stock_after_cancel
--     (commit 4584139).
--   - Re-décrémentation à la résurrection : NULLE PART (avant cette migration).
--
-- Conséquence métier : producer reçoit une commande à honorer mais voit un
-- stock erroné dans son interface. Si stock affiché > stock réel disponible,
-- producer commande/produit moins que nécessaire et ne peut pas honorer la
-- commande engagée.
--
-- Décision archi (option (c) ROBUSTE Romain 27/04) : RPC SQL atomique qui
-- lock + check stock + check slot + décrément + UPDATE statut, retournant
-- un enum text ('revived' | 'blocked_stock' | 'blocked_slot') que le caller
-- webhook traduit en :
--   - 'revived'        → continue le flow notifications producer (existant P1).
--   - 'blocked_stock'  → refund Stripe + email consumer + cancellation_reason
--                        = 'revival_blocked_stock'.
--   - 'blocked_slot'   → idem avec 'revival_blocked_slot'.
--
-- Multi-items : tout-ou-rien (un seul item en rupture → blocked_stock total +
-- refund total). Décision Romain : pas de partial fulfillment, le panier
-- consumer est un engagement atomique.
--
-- Slot saturé : le slot a été pris par un autre client entre la création de
-- l'order initiale (où le slot était disponible) et la résurrection. La
-- commande qu'on ressuscite est elle-même cancelled au moment du COUNT,
-- donc PAS comptée. La formule `slot_taken + 1 > capacity_per_slot` reste
-- correcte (cf RPC create_order_with_items ligne 117).
--
-- Pattern de lock : symétrique à create_order_with_items (commit 20260423130000).
--   - SELECT FOR UPDATE sur l'order (sérialise les webhooks rejoués).
--   - SELECT FOR UPDATE sur le slot.
--   - PERFORM 1 FOR UPDATE sur products ORDER BY id (anti-deadlock multi-row).
--
-- Le trigger orders_restore_stock_after_cancel (commit 4584139) NE se déclenche
-- PAS sur la transition cancelled → pending faite par cette RPC : sa clause
-- WHEN exige NEW.statut IN ('cancelled', 'refunded'). Donc pas de double
-- restauration possible. La décrémentation faite par cette RPC est nette.
--
-- SECURITY DEFINER + set search_path : pattern projet (cf
-- create_order_with_items, restore_product_stock_on_order_cancel). Bypass
-- RLS proprement pour pouvoir UPDATE products / orders depuis un contexte
-- service_role (webhook Stripe).
--
-- GRANT execute to service_role only : la RPC est appelée exclusivement
-- depuis le webhook handler en service_role. Pas de path browser.
-- =============================================================================

begin;

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
  select id, slot_id, statut, cancellation_reason
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
     or v_order.cancellation_reason is distinct from 'payment_failed' then
    raise exception 'Order % not eligible for revival (statut=%, reason=%)',
                    p_order_id, v_order.statut, v_order.cancellation_reason
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
      cancellation_reason = null,
      cancelled_at = null
  where id = p_order_id;

  return 'revived';
end;
$$;

grant execute on function public.revive_order_with_stock_check(uuid)
  to service_role;

commit;
