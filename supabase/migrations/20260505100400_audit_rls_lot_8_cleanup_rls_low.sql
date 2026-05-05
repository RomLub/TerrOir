-- =============================================================================
-- TerrOir — Audit RLS 2026-05-05 / Lot 8 : nettoyage cosmétique
-- =============================================================================
-- Findings traités :
--   - LOW-1 : policies `to public` → `to authenticated` (identity check only)
--   - LOW-4 : index composite producer_interests(statut, source)
--
-- Findings hors scope SQL :
--   - LOW-2 (admin policy users) : ARBITRAGE EN ATTENTE — cf. fix doc.
--   - LOW-3 (ACL trigger functions) : couvert par lot 1.
--   - LOW-5 (drift supabase_migrations) : DOC seulement, hors SQL.
--
-- Sévérité : LOW (cosmétique + perf marginal sur fortes charges anon).
-- Référence : docs/audits/audit-rls-2026-05-05.md sections L-1, L-4.
--
-- Contexte LOW-1 :
-- Les policies actuelles ciblent `to public` (pseudo-rôle qui agrège anon +
-- authenticated + service_role + tout autre rôle) même quand le check est
-- un identity check `auth.uid() = ...`. Pour un anon, auth.uid() est NULL,
-- donc la policy retourne NULL (≠ true) et l'access est refusée — mais
-- Postgres évalue quand même la policy. Scoper à `to authenticated` court-
-- circuite l'évaluation pour anon → micro-gain perf + intent explicite.
--
-- Les policies `public read` qui doivent rester `to public` (pour exposer aux
-- anon) :
--   - producers public read when public      (statut = 'public')
--   - products public read when producer public  (active=true + ...)
--   - slots public read when producer public
--   - slot_rules public read when producer public
--   - reviews public read when published
--   - producer_interests public insert       (anon + authenticated explicite)
--   - product_categories / animals / cuts read_public (true)
--   - gms_prices / gms_prules_history public read
--
-- Policies déjà correctement scopées `to authenticated` (lot 2 ou origine) :
--   - admin_users self read
--   - audit_logs / disputes / refund_incidents / refund_incident_attempts admin read
--   - producer_interests admin delete
--
-- Cette migration drop+recreate les ~22 policies identity-check restantes en
-- les scopant explicitement à `authenticated`.
--
-- Contexte LOW-4 :
-- L'admin /admin/producer-interests filtre fréquemment sur (statut, source)
-- pour distinguer les leads `formulaire_public` non encore contactés. L'index
-- existant `producer_interests_statut_idx` couvre `statut` seul. Volume
-- actuel négligeable (~10 leads), mais ajoute défensivement (~quelques KB)
-- avant la phase d'acquisition leads producteurs.
--
-- Idempotence : drop policy + create policy + create index if not exists.
--
-- Rollback : recréer chaque policy avec `to public`. `DROP INDEX IF EXISTS
-- public.producer_interests_statut_source_idx;` pour annuler l'index.
--
-- Tests : aucun test ne dépend du role scope explicite. Risque nul.
--
-- Pré-requis : appliquer d'abord les lots 1+2 (helpers + wraps déjà en place).
-- =============================================================================

begin;

-- =============================================================================
-- 1. Policies identity-check : `to public` → `to authenticated`
-- =============================================================================

-- 1.1 users -------------------------------------------------------------------
drop policy if exists "users self read"   on public.users;
drop policy if exists "users self insert" on public.users;
drop policy if exists "users self update" on public.users;

create policy "users self read"   on public.users for select
  to authenticated
  using ((select auth.uid()) = id);
create policy "users self insert" on public.users for insert
  to authenticated
  with check ((select auth.uid()) = id);
create policy "users self update" on public.users for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 1.2 producers (owner + admin) ----------------------------------------------
drop policy if exists "producers owner read"   on public.producers;
drop policy if exists "producers owner insert" on public.producers;
drop policy if exists "producers owner update" on public.producers;
drop policy if exists "producers admin all"    on public.producers;

create policy "producers owner read"   on public.producers for select
  to authenticated
  using ((select auth.uid()) = user_id);
create policy "producers owner insert" on public.producers for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
create policy "producers owner update" on public.producers for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "producers admin all" on public.producers for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 1.3 products owner ----------------------------------------------------------
drop policy if exists "products owner all" on public.products;
create policy "products owner all" on public.products for all
  to authenticated
  using ((select public.owns_producer(producer_id)))
  with check ((select public.owns_producer(producer_id)));

-- 1.4 slots owner -------------------------------------------------------------
drop policy if exists "slots owner all" on public.slots;
create policy "slots owner all" on public.slots for all
  to authenticated
  using ((select public.owns_producer(producer_id)))
  with check ((select public.owns_producer(producer_id)));

-- 1.5 slot_rules (owner + admin) ---------------------------------------------
drop policy if exists "slot_rules owner all" on public.slot_rules;
drop policy if exists "slot_rules admin all" on public.slot_rules;

create policy "slot_rules owner all" on public.slot_rules for all
  to authenticated
  using ((select public.owns_producer(producer_id)))
  with check ((select public.owns_producer(producer_id)));
create policy "slot_rules admin all" on public.slot_rules for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 1.6 orders ------------------------------------------------------------------
drop policy if exists "orders parties read"    on public.orders;
drop policy if exists "orders consumer insert" on public.orders;
drop policy if exists "orders parties update"  on public.orders;

create policy "orders parties read" on public.orders for select
  to authenticated
  using (
    (select auth.uid()) = consumer_id
    or (select public.owns_producer(producer_id))
  );
create policy "orders consumer insert" on public.orders for insert
  to authenticated
  with check ((select auth.uid()) = consumer_id);
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

-- 1.7 order_items -------------------------------------------------------------
drop policy if exists "order_items via order" on public.order_items;
create policy "order_items via order" on public.order_items for all
  to authenticated
  using ((select public.can_access_order(order_id)))
  with check ((select public.can_access_order(order_id)));

-- 1.8 reviews (author + consumer-insert) -------------------------------------
drop policy if exists "reviews author read"                           on public.reviews;
drop policy if exists "reviews consumer insert after completed order" on public.reviews;
drop policy if exists "reviews author update"                         on public.reviews;

create policy "reviews author read" on public.reviews for select
  to authenticated
  using ((select auth.uid()) = consumer_id);
create policy "reviews consumer insert after completed order" on public.reviews for insert
  to authenticated
  with check (
    (select auth.uid()) = consumer_id
    and (select public.is_completed_order_of_caller(order_id))
  );
create policy "reviews author update" on public.reviews for update
  to authenticated
  using ((select auth.uid()) = consumer_id)
  with check ((select auth.uid()) = consumer_id);

-- 1.9 payouts producer --------------------------------------------------------
drop policy if exists "payouts producer read" on public.payouts;
create policy "payouts producer read" on public.payouts for select
  to authenticated
  using ((select public.owns_producer(producer_id)));

-- 1.10 notifications owner ----------------------------------------------------
drop policy if exists "notifications owner read" on public.notifications;
create policy "notifications owner read" on public.notifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 1.11 producer_interests admin (read + update) ------------------------------
-- Note : "admin delete" est déjà `to authenticated` (origine), pas touché.
-- "public insert" reste `to anon, authenticated` (formulaire public).
drop policy if exists "producer_interests admin read"   on public.producer_interests;
drop policy if exists "producer_interests admin update" on public.producer_interests;

create policy "producer_interests admin read" on public.producer_interests for select
  to authenticated
  using ((select public.is_admin()));
create policy "producer_interests admin update" on public.producer_interests for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 1.12 producer_invitations admin --------------------------------------------
drop policy if exists "invitations admin all" on public.producer_invitations;
create policy "invitations admin all" on public.producer_invitations for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- =============================================================================
-- 2. Index composite producer_interests(statut, source) — LOW-4
-- =============================================================================
create index if not exists producer_interests_statut_source_idx
  on public.producer_interests (statut, source);

commit;
