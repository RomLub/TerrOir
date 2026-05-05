-- =============================================================================
-- TerrOir — Audit RLS 2026-05-05 / Lots 3+4 : optimisation perf RLS
-- =============================================================================
-- Findings traités : HIGH-1 (29 policies sans wrap (select ...)),
--                    HIGH-2 (5 policies EXISTS inline répétées par-row).
-- Sévérité : HIGH (perf RLS dégradée à terme — pas de faille de sécurité).
-- Référence : docs/audits/audit-rls-2026-05-05.md sections H-1, H-2.
--
-- Contexte HIGH-1 :
-- Les policies actuelles invoquent `auth.uid()`, `is_admin()`, `owns_producer()`
-- directement dans `using (...)` / `with check (...)`. Postgres réévalue ces
-- fonctions pour CHAQUE row scannée. Sur une requête SELECT ... LIMIT 50 d'une
-- table à 1M lignes, c'est 1M appels à auth.uid() → degradation perf 5-100x.
-- Le wrapper `(select fn(...))` force Postgres à InitPlan le résultat (1
-- évaluation par query, cachée pour le scan). Recommandation officielle
-- Supabase (cf. references/security-rls-performance.md skill).
--
-- Contexte HIGH-2 :
-- 5 policies évaluent des `EXISTS (SELECT 1 FROM <other_table> WHERE ...)`
-- inline par-row :
--   - products / slots / slot_rules : EXISTS sur producers (statut='public')
--   - order_items : EXISTS sur orders (consumer/producer mixed)
--   - reviews insert : EXISTS sur orders (statut='completed')
-- Remplacés par 3 helpers SECURITY DEFINER STABLE wrappés dans (select ...) :
-- Postgres cache leur résultat ET la SD bypasse l'éventuelle RLS de la table
-- cible — pattern aligné avec is_admin() / owns_producer().
--
-- Stratégie :
--   1. CREATE OR REPLACE des 3 helpers (idempotent).
--   2. REVOKE PUBLIC + GRANT explicit aux rôles RLS (anon + auth + sr).
--   3. Drop + recreate de toutes les policies impactées en wrappant chaque
--      auth.uid() / is_admin() / owns_producer() / EXISTS inline.
--   4. Le rôle des policies (`to public` / `to authenticated`) reste inchangé
--      ici — la rationalisation L-1 est traitée en lot 8 (cleanup_rls_low.sql).
--   5. Les policies admin sur audit_logs / disputes / refund_incidents /
--      refund_incident_attempts utilisent désormais `(select public.is_admin())`
--      au lieu du EXISTS inline répété sur admin_users — cohérence + perf.
--
-- Idempotence : DROP POLICY IF EXISTS + CREATE OR REPLACE FUNCTION. Re-run safe.
--
-- Rollback : non trivial (il faudrait recréer chacune des ~25 policies dans
-- leur version pré-wrap). Snapshot recommandé via `pg_dump --schema-only` avant
-- apply. Pour annuler les helpers : `DROP FUNCTION ... CASCADE` n'est pas safe
-- car les policies en dépendent — il faudrait d'abord recréer les policies
-- avec EXISTS inline.
--
-- Tests : aucun test SQL d'intégration sur RLS (TODO T-296). Sémantique des
-- policies strictement préservée (wrap = inline cached). Risque fonctionnel
-- faible. E2E Playwright à valider après apply pour confirmer non-régression.
--
-- Pré-requis : appliquer d'abord le lot 1 (harden_security_definer_acls.sql)
-- pour que les helpers `is_admin` / `owns_producer` aient les bons grants.
-- =============================================================================

begin;

-- =============================================================================
-- 1. Helpers RLS — replace EXISTS inline répétés par-row
-- =============================================================================

-- 1.1 is_producer_public(uuid) : products / slots / slot_rules public read
create or replace function public.is_producer_public(p_producer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.producers
    where id = p_producer_id and statut = 'public'
  );
$$;

-- 1.2 can_access_order(uuid) : order_items via order (parties read/insert/update)
create or replace function public.can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (o.consumer_id = auth.uid() or public.owns_producer(o.producer_id))
  );
$$;

-- 1.3 is_completed_order_of_caller(uuid) : reviews insert post-completed
create or replace function public.is_completed_order_of_caller(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orders
    where id = p_order_id
      and consumer_id = auth.uid()
      and statut = 'completed'
  );
$$;

-- ACL helpers : pattern aligné is_admin / owns_producer (cf. lot 1).
revoke execute on function public.is_producer_public(uuid)            from public;
revoke execute on function public.can_access_order(uuid)              from public;
revoke execute on function public.is_completed_order_of_caller(uuid)  from public;

grant  execute on function public.is_producer_public(uuid)
  to anon, authenticated, service_role;
grant  execute on function public.can_access_order(uuid)
  to anon, authenticated, service_role;
grant  execute on function public.is_completed_order_of_caller(uuid)
  to anon, authenticated, service_role;

-- =============================================================================
-- 2. Drop + recreate policies avec wrapping (select ...)
-- =============================================================================

-- 2.1 users -------------------------------------------------------------------
drop policy if exists "users self read"   on public.users;
drop policy if exists "users self insert" on public.users;
drop policy if exists "users self update" on public.users;

create policy "users self read"   on public.users for select
  using ((select auth.uid()) = id);
create policy "users self insert" on public.users for insert
  with check ((select auth.uid()) = id);
create policy "users self update" on public.users for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 2.2 admin_users -------------------------------------------------------------
drop policy if exists "admin_users self read" on public.admin_users;
create policy "admin_users self read" on public.admin_users for select
  to authenticated
  using (id = (select auth.uid()));

-- 2.3 producers ---------------------------------------------------------------
drop policy if exists "producers public read when public" on public.producers;
drop policy if exists "producers owner read"   on public.producers;
drop policy if exists "producers owner insert" on public.producers;
drop policy if exists "producers owner update" on public.producers;
drop policy if exists "producers admin all"    on public.producers;

create policy "producers public read when public" on public.producers for select
  using (statut = 'public');
create policy "producers owner read"   on public.producers for select
  using ((select auth.uid()) = user_id);
create policy "producers owner insert" on public.producers for insert
  with check ((select auth.uid()) = user_id);
create policy "producers owner update" on public.producers for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "producers admin all" on public.producers for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 2.4 products ----------------------------------------------------------------
drop policy if exists "products public read when producer public" on public.products;
drop policy if exists "products owner all" on public.products;

create policy "products public read when producer public" on public.products for select
  using (
    active = true
    and (select public.is_producer_public(producer_id))
  );
create policy "products owner all" on public.products for all
  using ((select public.owns_producer(producer_id)))
  with check ((select public.owns_producer(producer_id)));

-- 2.5 slots -------------------------------------------------------------------
drop policy if exists "slots public read when producer public" on public.slots;
drop policy if exists "slots owner all" on public.slots;

create policy "slots public read when producer public" on public.slots for select
  using ((select public.is_producer_public(producer_id)));
create policy "slots owner all" on public.slots for all
  using ((select public.owns_producer(producer_id)))
  with check ((select public.owns_producer(producer_id)));

-- 2.6 slot_rules --------------------------------------------------------------
drop policy if exists "slot_rules public read when producer public" on public.slot_rules;
drop policy if exists "slot_rules owner all" on public.slot_rules;
drop policy if exists "slot_rules admin all" on public.slot_rules;

create policy "slot_rules public read when producer public" on public.slot_rules for select
  using ((select public.is_producer_public(producer_id)));
create policy "slot_rules owner all" on public.slot_rules for all
  using ((select public.owns_producer(producer_id)))
  with check ((select public.owns_producer(producer_id)));
create policy "slot_rules admin all" on public.slot_rules for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 2.7 orders ------------------------------------------------------------------
drop policy if exists "orders parties read"    on public.orders;
drop policy if exists "orders consumer insert" on public.orders;
drop policy if exists "orders parties update"  on public.orders;

create policy "orders parties read" on public.orders for select
  using (
    (select auth.uid()) = consumer_id
    or (select public.owns_producer(producer_id))
  );
create policy "orders consumer insert" on public.orders for insert
  with check ((select auth.uid()) = consumer_id);
create policy "orders parties update" on public.orders for update
  using (
    (select auth.uid()) = consumer_id
    or (select public.owns_producer(producer_id))
  )
  with check (
    (select auth.uid()) = consumer_id
    or (select public.owns_producer(producer_id))
  );

-- 2.8 order_items -------------------------------------------------------------
drop policy if exists "order_items via order" on public.order_items;
create policy "order_items via order" on public.order_items for all
  using ((select public.can_access_order(order_id)))
  with check ((select public.can_access_order(order_id)));

-- 2.9 reviews -----------------------------------------------------------------
drop policy if exists "reviews public read when published"            on public.reviews;
drop policy if exists "reviews author read"                           on public.reviews;
drop policy if exists "reviews consumer insert after completed order" on public.reviews;
drop policy if exists "reviews author update"                         on public.reviews;

create policy "reviews public read when published" on public.reviews for select
  using (statut = 'published');
create policy "reviews author read" on public.reviews for select
  using ((select auth.uid()) = consumer_id);
create policy "reviews consumer insert after completed order" on public.reviews for insert
  with check (
    (select auth.uid()) = consumer_id
    and (select public.is_completed_order_of_caller(order_id))
  );
create policy "reviews author update" on public.reviews for update
  using ((select auth.uid()) = consumer_id)
  with check ((select auth.uid()) = consumer_id);

-- 2.10 payouts ----------------------------------------------------------------
drop policy if exists "payouts producer read" on public.payouts;
create policy "payouts producer read" on public.payouts for select
  using ((select public.owns_producer(producer_id)));

-- 2.11 notifications ----------------------------------------------------------
drop policy if exists "notifications owner read" on public.notifications;
create policy "notifications owner read" on public.notifications for select
  using ((select auth.uid()) = user_id);

-- 2.12 producer_interests -----------------------------------------------------
drop policy if exists "producer_interests public insert" on public.producer_interests;
drop policy if exists "producer_interests admin read"    on public.producer_interests;
drop policy if exists "producer_interests admin update"  on public.producer_interests;
drop policy if exists "producer_interests admin delete"  on public.producer_interests;

create policy "producer_interests public insert" on public.producer_interests for insert
  to anon, authenticated
  with check (true);
create policy "producer_interests admin read" on public.producer_interests for select
  using ((select public.is_admin()));
create policy "producer_interests admin update" on public.producer_interests for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "producer_interests admin delete" on public.producer_interests for delete
  to authenticated
  using ((select public.is_admin()));

-- 2.13 producer_invitations ---------------------------------------------------
drop policy if exists "invitations admin all" on public.producer_invitations;
create policy "invitations admin all" on public.producer_invitations for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 2.14 audit_logs (refactor EXISTS admin_users → is_admin) --------------------
drop policy if exists "audit_logs admin read" on public.audit_logs;
create policy "audit_logs admin read" on public.audit_logs for select
  to authenticated
  using ((select public.is_admin()));

-- 2.15 disputes (refactor EXISTS admin_users → is_admin) ----------------------
drop policy if exists "disputes admin read" on public.disputes;
create policy "disputes admin read" on public.disputes for select
  to authenticated
  using ((select public.is_admin()));

-- 2.16 refund_incidents (refactor EXISTS admin_users → is_admin) --------------
drop policy if exists "refund_incidents admin read" on public.refund_incidents;
create policy "refund_incidents admin read" on public.refund_incidents for select
  to authenticated
  using ((select public.is_admin()));

-- 2.17 refund_incident_attempts (refactor EXISTS admin_users → is_admin) ------
drop policy if exists "refund_incident_attempts admin read" on public.refund_incident_attempts;
create policy "refund_incident_attempts admin read" on public.refund_incident_attempts for select
  to authenticated
  using ((select public.is_admin()));

commit;
