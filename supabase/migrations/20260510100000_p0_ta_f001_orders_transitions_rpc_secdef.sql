-- =============================================================================
-- TerrOir — F-001 : transitions orders via RPC SECDEF + retrait policy UPDATE
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-001) : la policy
-- "orders parties update" autorise tout consumer/producer à modifier
-- n'importe quelle colonne de sa propre order via PostgREST direct
-- (`PATCH /orders?id=eq.<own>`). Bypass complet du paiement Stripe et du
-- flux de validation producer possible (consumer peut self-passer son
-- order à `completed`, modifier `montant_total` à 1€, etc.).
--
-- DECISION (Romain 2026-05-10) : router toutes les transitions order via
-- RPC SECURITY DEFINER dédiées. La policy UPDATE owner est retirée et
-- remplacée par une policy "orders service_role update only" explicite
-- documentaire (zéro effet runtime — service_role bypass déjà — mais
-- ancrage pg_policies clair pour audit). Aucun client authenticated ne
-- peut plus modifier orders directement.
--
-- 3 RPC exposées :
--   1. confirm_order_by_producer(p_order_id uuid)
--      pending → confirmed, posé par producer-owner / admin / service_role
--   2. complete_pickup_by_producer(p_order_id uuid, p_submitted_code text)
--      confirmed → completed, posé par producer-owner / admin / service_role
--      Si p_submitted_code IS NOT NULL : valide (case-insensitive +
--      normalisation alphanum) vs order.code_commande. Si NULL : skip
--      (caller id-based fait sa propre vérif applicative).
--   3. cancel_order(p_order_id uuid, p_reason text, p_target_status text)
--      pending|confirmed → cancelled|refunded.
--      Auth dispatch interne (priorité admin > producer > consumer).
--      Le caller ne précise PAS son rôle — déduit via auth.uid() +
--      is_admin() + owns_producer() pour fermer la surface d'attaque.
--
-- Pattern commun :
--   - SECURITY DEFINER + search_path explicite (idempotence Postgres)
--   - bypass service_role via auth.role()
--   - dispatch auth interne (admin > producer > consumer)
--   - whitelist stricte sur p_target_status (RPC-spécifique)
--   - assertTransition SQL miroir de lib/orders/stateMachine.ts TRANSITIONS
--   - UPDATE atomique race-safe via .eq("statut", from)
--   - audit_logs INSERT dans la même transaction (tombe gratuitement)
--   - RAISE SQLSTATE typé : 02000 not_found / 42501 forbidden /
--     P0001 illegal_transition / 40001 race_lost
--   - REVOKE EXECUTE PUBLIC + GRANT EXECUTE authenticated, service_role
--
-- F-035 + F-036 (audit logs cancel/confirm explicites) tombent
-- gratuitement avec ces RPC : INSERT audit_logs cluster `order_*` dans la
-- même transaction que l'UPDATE.
--
-- Doctrine T-297 (idempotence forward-only) :
--   - CREATE OR REPLACE FUNCTION sur les 3 RPC
--   - DROP POLICY IF EXISTS + CREATE POLICY pour la policy UPDATE
--
-- Rollback (jamais utilisé en pratique, doctrine forward-only T-297) :
--   docs/runbooks/rollback-p0-ta-f001-2026-05.sql
--   (procédure complète + smoke tests post-rollback)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper interne : assert transition légale, sinon raise P0001
-- Miroir de lib/orders/stateMachine.ts TRANSITIONS.
-- =============================================================================

create or replace function public._assert_order_transition(
  p_from text,
  p_to text
)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_from = 'pending' and p_to in ('confirmed', 'cancelled', 'refunded') then
    return;
  end if;
  if p_from = 'confirmed' and p_to in ('completed', 'cancelled', 'refunded') then
    return;
  end if;
  raise exception 'illegal_transition_from_%_to_%', p_from, p_to
    using errcode = 'P0001',
          hint = 'illegal_transition',
          detail = format('from=%s;to=%s', p_from, p_to);
end $$;

revoke execute on function public._assert_order_transition(text, text) from public, anon, authenticated;
-- Helper interne consommé uniquement par les 3 RPC SECDEF ci-dessous, qui
-- s'exécutent avec les droits du créateur (postgres) → bypass ACL.
-- Pas besoin de GRANT EXECUTE applicatif.


-- =============================================================================
-- 1. confirm_order_by_producer(p_order_id uuid)
--    pending → confirmed
-- =============================================================================

create or replace function public.confirm_order_by_producer(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_caller_role text := auth.role();
  v_order public.orders%rowtype;
  v_by text;
  v_confirmed_at timestamptz := now();
  v_current_status text;
begin
  -- 1) Lookup
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = '02000';
  end if;

  -- 2) Auth dispatch (priorité admin > producer)
  if v_caller_role = 'service_role' then
    v_by := 'service_role';
  elsif (select public.is_admin()) then
    v_by := 'admin';
  elsif (select public.owns_producer(v_order.producer_id)) then
    v_by := 'producer';
  else
    raise exception 'forbidden_not_owner_or_admin' using errcode = '42501';
  end if;

  -- 3) Idempotence
  if v_order.statut = 'confirmed' then
    return p_order_id;
  end if;

  -- 4) Transition légale (whitelist : confirm cible 'confirmed' uniquement)
  perform public._assert_order_transition(v_order.statut, 'confirmed');

  -- 5) UPDATE atomique race-safe
  update public.orders
  set statut = 'confirmed',
      confirmed_at = v_confirmed_at
  where id = p_order_id
    and statut = 'pending';

  if not found then
    -- Race : un autre flow a transitionné entre 1) et 5). Re-lecture.
    select statut into v_current_status from public.orders where id = p_order_id;
    if v_current_status = 'confirmed' then
      return p_order_id;
    end if;
    raise exception 'race_lost_status_drift_to_%', v_current_status
      using errcode = '40001';
  end if;

  -- 6) Audit log forensique (tombe gratuitement avec la RPC, F-036)
  insert into public.audit_logs (user_id, event_type, metadata)
  values (
    coalesce(v_caller_uid, v_order.consumer_id),
    'order_confirmed',
    jsonb_build_object(
      'order_id', p_order_id,
      'producer_id', v_order.producer_id,
      'by', v_by,
      'confirmed_at', v_confirmed_at
    )
  );

  return p_order_id;
end $$;

revoke execute on function public.confirm_order_by_producer(uuid) from public, anon;
grant execute on function public.confirm_order_by_producer(uuid) to authenticated, service_role;


-- =============================================================================
-- 2. complete_pickup_by_producer(p_order_id uuid, p_submitted_code text)
--    confirmed → completed
--    p_submitted_code optionnel : si fourni, validé case-insensitive +
--    normalisation alphanum (cycle qualité doctrine D-9 client strip /
--    server strict). Si NULL : skip (caller id-based vérifie applicativement).
-- =============================================================================

create or replace function public.complete_pickup_by_producer(
  p_order_id uuid,
  p_submitted_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_caller_role text := auth.role();
  v_order public.orders%rowtype;
  v_by text;
  v_completed_at timestamptz := now();
  v_submitted_norm text;
  v_expected_norm text;
  v_current_status text;
begin
  -- 1) Lookup
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = '02000';
  end if;

  -- 2) Auth dispatch (priorité admin > producer)
  if v_caller_role = 'service_role' then
    v_by := 'service_role';
  elsif (select public.is_admin()) then
    v_by := 'admin';
  elsif (select public.owns_producer(v_order.producer_id)) then
    v_by := 'producer';
  else
    raise exception 'forbidden_not_owner_or_admin' using errcode = '42501';
  end if;

  -- 2bis) Validation code si fourni (mode code-based)
  if p_submitted_code is not null then
    v_submitted_norm := regexp_replace(upper(p_submitted_code), '[^A-Z0-9]', '', 'g');
    v_expected_norm := regexp_replace(upper(v_order.code_commande), '[^A-Z0-9]', '', 'g');
    if v_submitted_norm <> v_expected_norm then
      raise exception 'invalid_pickup_code' using errcode = '22023';
    end if;
  end if;

  -- 3) Idempotence
  if v_order.statut = 'completed' then
    return p_order_id;
  end if;

  -- 4) Transition légale (whitelist : complete cible 'completed' uniquement)
  perform public._assert_order_transition(v_order.statut, 'completed');

  -- 5) UPDATE atomique race-safe
  update public.orders
  set statut = 'completed',
      completed_at = v_completed_at
  where id = p_order_id
    and statut = 'confirmed';

  if not found then
    -- Race : autre flow a transitionné. Idempotent à 'completed' attendu.
    select statut into v_current_status from public.orders where id = p_order_id;
    if v_current_status = 'completed' then
      return p_order_id;
    end if;
    raise exception 'race_lost_status_drift_to_%', v_current_status
      using errcode = '40001';
  end if;

  -- 6) Audit log forensique cluster pickup_*
  insert into public.audit_logs (user_id, event_type, metadata)
  values (
    coalesce(v_caller_uid, v_order.consumer_id),
    'pickup_validated',
    jsonb_build_object(
      'order_id', p_order_id,
      'producer_id', v_order.producer_id,
      'by', v_by,
      'completed_at', v_completed_at,
      'code_validated', p_submitted_code is not null,
      'route', 'rpc_secdef'
    )
  );

  return p_order_id;
end $$;

revoke execute on function public.complete_pickup_by_producer(uuid, text) from public, anon;
grant execute on function public.complete_pickup_by_producer(uuid, text) to authenticated, service_role;


-- =============================================================================
-- 3. cancel_order(p_order_id uuid, p_reason text, p_target_status text)
--    pending|confirmed → cancelled|refunded
--
--    Auth dispatch interne (priorité admin > producer > consumer).
--    Le caller ne précise PAS son rôle — déduit via auth.uid().
--
--    Whitelist stricte :
--      p_target_status ∈ ('cancelled', 'refunded')
--      p_reason ∈ ('stock', 'producer_cancel', 'consumer_cancel', 'timeout',
--                  'other', 'admin_refund', 'payment_failed',
--                  'revival_blocked_stock', 'revival_blocked_slot',
--                  'efw_preemptive')
--      (cf METHODOLOGY.md "Taxonomie closure_reason")
--
--    Consumer ne peut cancel que pending → cancelled (canConsumerCancel
--    miroir lib/orders/stateMachine.ts) avec p_reason forcé 'consumer_cancel'
--    côté caller (la RPC valide la whitelist + l'auth, pas la cohérence
--    sémantique caller-reason — c'est la responsabilité de la route).
--
--    Le refund Stripe reste côté applicatif : la RPC ne parle pas à Stripe.
--    Caller appelle stripe.refunds.create AVANT la RPC, puis RPC avec
--    p_target_status='refunded' si le refund Stripe a réussi, sinon
--    'cancelled'. Trigger BEFORE UPDATE de statut sur orders restore le
--    stock côté DB (cf migration 20260427200000).
-- =============================================================================

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text,
  p_target_status text default 'cancelled'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_caller_role text := auth.role();
  v_order public.orders%rowtype;
  v_by text;
  v_cancelled_at timestamptz := now();
  v_current_status text;
  v_allowed_reasons constant text[] := array[
    'stock', 'producer_cancel', 'consumer_cancel', 'timeout', 'other',
    'admin_refund', 'payment_failed',
    'revival_blocked_stock', 'revival_blocked_slot',
    'efw_preemptive'
  ];
begin
  -- 0) Whitelist target_status + reason
  if p_target_status not in ('cancelled', 'refunded') then
    raise exception 'invalid_target_status_%', p_target_status
      using errcode = '22023';
  end if;
  if p_reason is null or not (p_reason = any(v_allowed_reasons)) then
    raise exception 'invalid_reason_%', coalesce(p_reason, 'null')
      using errcode = '22023';
  end if;

  -- 1) Lookup
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = '02000';
  end if;

  -- 2) Auth dispatch (priorité service_role > admin > producer > consumer)
  if v_caller_role = 'service_role' then
    v_by := 'service_role';
  elsif (select public.is_admin()) then
    v_by := 'admin';
  elsif (select public.owns_producer(v_order.producer_id)) then
    v_by := 'producer';
  elsif v_caller_uid = v_order.consumer_id
        and v_order.statut = 'pending'
        and p_target_status = 'cancelled'
        and p_reason = 'consumer_cancel'
  then
    -- Consumer ne peut cancel que pending → cancelled avec reason
    -- consumer_cancel (canConsumerCancel miroir lib/orders/stateMachine.ts).
    v_by := 'consumer';
  else
    raise exception 'forbidden_not_authorized_caller' using errcode = '42501';
  end if;

  -- 3) Idempotence (déjà terminal)
  if v_order.statut in ('cancelled', 'refunded', 'completed') then
    return p_order_id;
  end if;

  -- 4) Transition légale
  perform public._assert_order_transition(v_order.statut, p_target_status);

  -- 5) UPDATE atomique race-safe
  update public.orders
  set statut = p_target_status,
      closure_reason = p_reason,
      cancelled_at = v_cancelled_at
  where id = p_order_id
    and statut = v_order.statut;

  if not found then
    -- Race : autre flow a transitionné entre lookup et UPDATE.
    select statut into v_current_status from public.orders where id = p_order_id;
    if v_current_status in ('cancelled', 'refunded', 'completed') then
      -- Déjà terminal → idempotent OK.
      return p_order_id;
    end if;
    raise exception 'race_lost_status_drift_to_%', v_current_status
      using errcode = '40001';
  end if;

  -- 6) Audit log forensique cluster order_*  (F-035 tombe gratuitement)
  -- Skip si caller-context fait déjà un audit Stripe-aware (admin_refund,
  -- timeout, efw_preemptive) pour éviter double log redondant. Le caller
  -- a déjà l'event avec contexte Stripe (refund_id, amount, etc.) plus
  -- riche que ce que la RPC pourrait ajouter ici.
  if p_reason not in ('admin_refund', 'timeout', 'efw_preemptive') then
    insert into public.audit_logs (user_id, event_type, metadata)
    values (
      coalesce(v_caller_uid, v_order.consumer_id),
      'order_cancelled',
      jsonb_build_object(
        'order_id', p_order_id,
        'producer_id', v_order.producer_id,
        'consumer_id', v_order.consumer_id,
        'by', v_by,
        'reason', p_reason,
        'target_status', p_target_status,
        'cancelled_at', v_cancelled_at
      )
    );
  end if;

  return p_order_id;
end $$;

revoke execute on function public.cancel_order(uuid, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, text, text) to authenticated, service_role;


-- =============================================================================
-- Retrait policy "orders parties update" + ancrage policy explicite
-- =============================================================================
-- DROP propre + CREATE policy doc-only "orders service_role update only".
-- service_role bypass RLS par défaut (orders n'a pas FORCE ROW LEVEL SECURITY,
-- doctrine audit-rls-lot-7 "tout admin via service_role"). La nouvelle
-- policy n'a aucun effet runtime — son but est d'ancrer l'intention dans
-- pg_policies pour qu'un futur dev (humain ou agent) qui regarde les
-- policies orders comprenne immédiatement que les UPDATE owner ont été
-- volontairement retirés au profit des RPC SECDEF.
-- =============================================================================

drop policy if exists "orders parties update" on public.orders;

-- Marqueur d'intention. Aucun client authenticated ne peut désormais UPDATE
-- orders directement — toutes les transitions passent par les 3 RPC SECDEF
-- ci-dessus, et les UPDATE metadata (stripe_payment_intent_id, cgv_*) passent
-- par admin client (service_role bypass RLS).
create policy "orders service_role update only" on public.orders
  for update
  to authenticated
  using (false)
  with check (false);
