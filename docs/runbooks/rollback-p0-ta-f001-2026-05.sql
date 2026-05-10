-- =============================================================================
-- ROLLBACK F-001 — TerrOir
-- =============================================================================
-- A COLLER en Supabase SQL Studio en cas de KO post-apply migration
-- 20260510100000_p0_ta_f001_orders_transitions_rpc_secdef.sql.
--
-- /!\ FORWARD-ONLY DOCTRINE (T-297) :
-- Ce rollback DROP les RPC et restaure la policy "orders parties update"
-- mais NE TOUCHE PAS aux audit_logs crees entre l'apply et le rollback.
-- Les events `order_confirmed`, `pickup_validated`, `order_cancelled` poses
-- pendant la fenetre apply -> rollback restent en base. C'est CONFORME doctrine
-- (forward-only, append-only) — ces events documentent factuellement les
-- transitions qui ont eu lieu, leur conservation est utile forensiquement
-- meme post-rollback.
--
-- Effet :
--   1. DROP des 3 RPC SECDEF + helper interne _assert_order_transition
--   2. DROP de la policy "orders service_role update only" (doc-only)
--   3. RECREATE policy "orders parties update" originale (etat post-LOT 8
--      audit-rls-2026-05-05, derniere version connue avant F-001)
--
-- Note : les call sites cote code resteront a appeler les .rpc() inexistantes
-- -> 500 sur les flows confirm/complete/cancel/refund/timeout. Le rollback
-- DB seul ne suffit PAS a restaurer la prod fonctionnelle ; il faut aussi
-- revert le code (Vercel promote previous deploy).
--
-- Procedure complete si etape 9 KO :
--   (a) ICI : copier-coller ce SQL en Supabase SQL Studio (~5s d'execution)
--   (b) Vercel UI > project terr-oir-21cl > Deployments > Promote
--       le deploy d'avant le merge de la PR P0-TA en Production
--   (c) Smoke tests post-rollback (cf bas de fichier)
--   (d) Conserver le fichier migration applied cote disque + supabase_migrations
--       (forward-only doctrine T-297) pour tracabilite — le rollback est
--       SQL Studio direct, pas une nouvelle migration timestamped.
-- =============================================================================

begin;

-- 1. DROP des 3 RPC + helper interne
drop function if exists public.confirm_order_by_producer(uuid);
drop function if exists public.complete_pickup_by_producer(uuid, text);
drop function if exists public.cancel_order(uuid, text, text);
drop function if exists public._assert_order_transition(text, text);

-- 2. DROP policy doc-only F-001
drop policy if exists "orders service_role update only" on public.orders;

-- 3. RECREATE policy "orders parties update" originale (etat LOT 8 2026-05-05)
drop policy if exists "orders parties update" on public.orders;
create policy "orders parties update" on public.orders for update
  to authenticated
  using (
    (select auth.uid()) = consumer_id
    or (select public.owns_producer(producer_id))
  )
  with check (
    (select auth.uid()) = consumer_id
    or (select public.owns_producer(producer_id))
  );

commit;

-- =============================================================================
-- Smoke tests post-rollback (manuel, execution separee)
-- =============================================================================
--
-- TEST 1 — RPC absentes (sanity DB)
--   SELECT public.confirm_order_by_producer('00000000-0000-0000-0000-000000000000');
--   -> ERROR: function public.confirm_order_by_producer(uuid) does not exist
--   (coherent — RPC droppees)
--
-- TEST 2 — Policy UPDATE owner restauree (sanity RLS)
--   Caller authenticated, auth.uid() = producer-owner d'une order pending :
--   UPDATE public.orders SET notes_client = 'rollback test' WHERE id = '<own-pending>';
--   -> 1 row affected (policy a nouveau permissive, attendu post-rollback)
--
-- TEST 3 — End-to-end UI prod (le test qui prouve que prod re-fonctionne)
--   Avec Vercel promu sur deploy pre-merge (etape b ci-dessus) :
--   1. Login consumer https://www.terroir-local.fr/connexion sur compte de test
--   2. Aller sur /compte/commandes
--   3. Selectionner une order au statut 'pending'
--   4. Cliquer "Annuler ma commande"
--   5. ATTENDU : statut UI passe a "Annulee", refund Stripe emis si payee.
--      audit_logs : pas d'event `order_cancelled` pose (l'ancien path
--      pre-F-001 n'avait pas cet audit explicite — c'est precisement ce
--      que F-001 venait apporter via la RPC). Verifier juste statut UI +
--      refund Stripe Dashboard.
--   6. SI ECHEC a l'etape 5 : la prod est cassee hors-DB (probable cause :
--      Vercel n'a pas effectivement promu, env vars, autre incident).
--      Escalade Romain.
