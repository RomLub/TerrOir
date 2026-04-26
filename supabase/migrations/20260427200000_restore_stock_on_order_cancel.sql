-- =============================================================================
-- TerrOir — Restauration automatique du stock à l'annulation d'une commande
-- =============================================================================
-- Bug P0 (détecté 26/04 lors de l'inspection 3DS échoué) : la RPC
-- create_order_with_items décrémente products.stock_disponible -= quantite à
-- l'INSERT (cf 20260423130000 ligne 207), mais aucun chemin du repo ne
-- ré-incrémente jamais à l'annulation. Conséquence : un produit avec
-- stock_disponible=5 peut tomber à 0 après 5 annulations (3DS échoué,
-- timeout cron, cancel consumer/producer, refund admin) sans qu'aucune
-- commande complétée n'ait été honorée.
--
-- Décision archi : trigger DB (pas code applicatif), symétrique au pattern
-- de décrémentation déjà côté DB. Avantages :
--   - Couvre tous les call sites d'UPDATE orders.statut sans toucher au code
--     applicatif (webhook payment_failed, cron timeout, /api/orders/cancel,
--     /api/stripe/refund, et tout futur point d'entrée).
--   - Symétrique de la décrémentation côté RPC.
--   - Atomique avec le UPDATE orders (même transaction → pas de désync
--     possible entre statut et stock).
--
-- Transitions cibles (filtrées au niveau PG par la clause WHEN) :
--   OLD.statut ∈ ('pending','confirmed','ready') ET
--   NEW.statut ∈ ('cancelled','refunded')
--
-- Cas EXPLICITEMENT EXCLUS :
--   - completed → refunded : produit physiquement parti, restaurer le stock
--     serait factuellement faux (litige post-retrait, le client a le produit).
--   - cancelled → cancelled (webhook Stripe rejoué) : `IS DISTINCT FROM`
--     filtre, no-op idempotent.
--   - pending → confirmed / pending → ready / etc. : pas une annulation.
--
-- SECURITY DEFINER + set search_path : pattern projet (cf
-- create_order_with_items, is_admin, owns_producer). Indispensable car la
-- table products a RLS ENABLE et la policy "products owner all" bloquerait
-- un UPDATE déclenché depuis un consumer authenticated qui annule via
-- /api/orders/[id]/cancel. Le trigger doit pouvoir UPDATE quel que soit le
-- contexte d'auth de la transaction qui modifie orders.statut.
--
-- Pas de RAISE NOTICE/DEBUG (pattern projet : aucun trigger existant n'en
-- émet — orders_set_code_before_insert, orders_commission_before_*,
-- users_exclusive_with_admin sont tous silencieux). La traçabilité
-- forensique des annulations ira dans audit_logs (cf 20260427100000
-- périmètre futur "payment_*, refund_*"), pas dans les Postgres logs.
--
-- Backfill : aucun. Producteurs en prod = seeds de test, stocks fictifs.
-- Décision Romain 26/04.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Fonction trigger
-- -----------------------------------------------------------------------------
-- Itère sur les order_items de la commande qui vient de transitionner et
-- ré-incrémente products.stock_disponible de la quantite correspondante.
-- Filtre stock_illimite=false : symétrique au filter ligne 205 de la RPC
-- (pas d'incrémentation fantôme sur produits illimités, pour qui la colonne
-- stock_disponible n'a aucune sémantique).
--
-- L'arithmétique reproduit exactement le pattern de la RPC ligne 207
-- (stock_disponible = stock_disponible - v_quantite, sans cast explicite).
-- PG résout via numeric pour la soustraction puis ré-assigne en int avec
-- troncature implicite. Toute évolution future de la RPC s'applique
-- mécaniquement à la restauration.
create or replace function public.restore_product_stock_on_order_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
begin
  for v_item in
    select product_id, quantite
    from public.order_items
    where order_id = new.id
  loop
    update public.products
    set stock_disponible = stock_disponible + v_item.quantite
    where id = v_item.product_id
      and stock_illimite = false;
  end loop;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Trigger AFTER UPDATE OF statut
-- -----------------------------------------------------------------------------
-- AFTER (pas BEFORE) : la commande est déjà cancelled/refunded au moment
-- où on restaure, état canonique pour les éventuels SELECT en lecture
-- réplique. La fonction ne modifie pas NEW de toute façon.
--
-- OF statut : la fonction ne s'arme QUE si la colonne statut est dans le
-- SET du UPDATE. Évite des évaluations WHEN inutiles sur des UPDATE qui
-- ne touchent que d'autres colonnes (ex. set stripe_payment_intent_id,
-- ou un éventuel futur set notes_admin).
--
-- WHEN : double-filtre les transitions cibles au niveau PG. Garantit
-- l'idempotence (cancelled → cancelled rejoué = no-op) ET l'exclusion du
-- cas litige (completed → refunded ignoré).
create trigger orders_restore_stock_after_cancel
  after update of statut on public.orders
  for each row
  when (
    old.statut is distinct from new.statut
    and old.statut in ('pending', 'confirmed', 'ready')
    and new.statut in ('cancelled', 'refunded')
  )
  execute function public.restore_product_stock_on_order_cancel();

commit;
