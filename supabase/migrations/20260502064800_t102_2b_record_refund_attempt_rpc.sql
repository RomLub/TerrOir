-- =============================================================================
-- TerrOir — RPC public.record_refund_attempt (T-102.2.b)
-- =============================================================================
-- Pose la fonction transactionnelle qui UPSERT public.refund_incidents +
-- INSERT public.refund_incident_attempts en un seul round-trip atomique.
--
-- Consommée par lib/refund-incidents/record-refund-attempt.ts (helper TS
-- fail-safe), lui-même appelé par les 3 paths refund (T-102.2.b) :
--   - lib/stripe/handle-payment-succeeded.ts      (kind='revival')
--   - app/api/stripe/refund/route.ts              (kind='admin')
--   - app/api/cron/order-timeout/route.tsx        (kind='timeout')
-- Le helper retry T-102.2.c (lib/stripe/retry-failed-refund.ts) appellera
-- la même RPC avec outcome='failed'|'succeeded' selon résultat retry.
--
-- Pourquoi RPC plpgsql plutôt que 2 INSERTs JS séquentiels :
--   - Atomicité transaction implicite : pas de fenêtre de race entre
--     UPSERT incident et INSERT attempt.
--   - Cohérence retry_count + status + resolved_at en un seul state move.
--   - Pattern repo aligné avec create_order_with_items, revive_order_*,
--     delete_user_account.
--
-- Décisions orchestrateur figées (T-102.2.b inspection) :
--   Q3 — RPC plpgsql atomique (vs 2 INSERTs JS).
--   Q4 — Court-circuit `category='permanent'` ACTIF : premier échec avec
--        classification permanent passe direct status='exhausted' +
--        resolved_at=now(). Évite 1-3 retries inutiles côté cron T-102.2.c.
--   Q8 — Helper paramétré par outcome ∈ {failed, succeeded} pour
--        réutilisation T-102.2.c.
--
-- Sémantique state transitions :
--   INSERT path (1er passage sur (order_id, kind)) :
--     - outcome='failed' + classification='permanent'   → status='exhausted', retry_count=1, resolved_at=now()
--     - outcome='failed' + classification autre/null    → status='pending',   retry_count=1, resolved_at=null
--     - outcome='succeeded' (premier coup, théorique)   → status='succeeded', retry_count=0, resolved_at=now()
--   UPDATE path (ON CONFLICT, retry T-102.2.c) :
--     - outcome='failed' + classification='permanent'   → status='exhausted', retry_count++, resolved_at=now() (si pas déjà set)
--     - outcome='failed' + status='pending'             → status='retrying',  retry_count++
--     - outcome='failed' + status='retrying'            → status='retrying',  retry_count++
--     - outcome='succeeded'                             → status='succeeded', retry_count inchangé, resolved_at=now()
--
-- Sémantique attempt_number :
--   - Échec : attempt_number = retry_count post-INSERT/UPDATE (1 au premier
--     échec, 2 au deuxième, …). Cohérent avec la sémantique « le N-ième
--     échec produit attempt#N ».
--   - Succès : attempt_number = retry_count + 1 (le succès n'incrémente
--     pas retry_count, mais consomme un slot d'attempt). Premier succès
--     direct (retry_count=0) → attempt#1. Succès après 1 échec
--     (retry_count=1) → attempt#2.
--
-- Validation inputs : raise exception sur kind/outcome/classification
-- hors enum. Cohérent avec les CHECK constraints T-102.1 mais validé
-- côté RPC pour rapprocher l'erreur du caller (au lieu de 23514 obscur).
--
-- Idempotency RPC : NON (la RPC ne porte pas d'idempotency key Stripe).
-- L'idempotency Stripe reste portée côté call site via le 2e arg de
-- stripe.refunds.create({...}, {idempotencyKey: ...}). La RPC garantit
-- juste que l'écriture DB n'est pas dupliquée via UNIQUE (order_id, kind).
--
-- security definer + search_path verrouillé : conforme au pattern repo
-- (revive_order_with_stock_check, create_order_with_items). Permet d'être
-- appelée par service_role sans soucis RLS sur les 2 tables (qui sont
-- déjà write-via-service-role par convention T-102.1).
-- =============================================================================

begin;

create or replace function public.record_refund_attempt(
  p_order_id              uuid,
  p_kind                  text,
  p_payment_intent_id     text,
  p_consumer_id           uuid,
  p_blocked_reason        text,
  p_outcome               text,
  p_stripe_error_code     text,
  p_stripe_error_type     text,
  p_stripe_error_message  text,
  p_stripe_request_id     text,
  p_stripe_refund_id      text,
  p_classification        text,
  p_first_failed_event_at timestamptz
)
returns table (
  incident_id     uuid,
  incident_status text,
  attempt_id      uuid,
  attempt_number  int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident_id    uuid;
  v_attempt_id     uuid;
  v_attempt_number int;
  v_status         text;
  v_retry_count    int;
begin
  -- Validation inputs
  if p_kind not in ('revival', 'admin', 'timeout') then
    raise exception 'invalid kind: %', p_kind using errcode = '22023';
  end if;
  if p_outcome not in ('failed', 'succeeded') then
    raise exception 'invalid outcome: %', p_outcome using errcode = '22023';
  end if;
  if p_classification is not null
     and p_classification not in ('safe_to_retry', 'permanent', 'unknown') then
    raise exception 'invalid classification: %', p_classification using errcode = '22023';
  end if;

  -- UPSERT incident. Le INSERT pose resolved_at quand le status terminal
  -- (exhausted ou succeeded) est atteint dès le 1er coup. Le UPDATE le pose
  -- en transition vers terminal s'il n'est pas déjà set.
  insert into public.refund_incidents (
    order_id,
    kind,
    payment_intent_id,
    consumer_id,
    blocked_reason,
    status,
    retry_count,
    last_error_code,
    last_error_message,
    first_failed_event_at,
    resolved_at
  )
  values (
    p_order_id,
    p_kind,
    p_payment_intent_id,
    p_consumer_id,
    p_blocked_reason,
    case
      when p_outcome = 'failed' and p_classification = 'permanent' then 'exhausted'
      when p_outcome = 'failed' then 'pending'
      when p_outcome = 'succeeded' then 'succeeded'
    end,
    case when p_outcome = 'failed' then 1 else 0 end,
    p_stripe_error_code,
    p_stripe_error_message,
    p_first_failed_event_at,
    case
      when p_outcome = 'failed' and p_classification = 'permanent' then now()
      when p_outcome = 'succeeded' then now()
      else null
    end
  )
  on conflict (order_id, kind) do update set
    retry_count = case
      when excluded.retry_count > 0 then refund_incidents.retry_count + 1
      else refund_incidents.retry_count
    end,
    last_error_code = case
      when p_outcome = 'failed' then excluded.last_error_code
      else refund_incidents.last_error_code
    end,
    last_error_message = case
      when p_outcome = 'failed' then excluded.last_error_message
      else refund_incidents.last_error_message
    end,
    status = case
      when p_outcome = 'succeeded' then 'succeeded'
      when p_outcome = 'failed' and p_classification = 'permanent' then 'exhausted'
      when p_outcome = 'failed' and refund_incidents.status = 'pending' then 'retrying'
      else refund_incidents.status
    end,
    resolved_at = case
      when p_outcome = 'succeeded' then now()
      when p_outcome = 'failed' and p_classification = 'permanent'
           and refund_incidents.resolved_at is null then now()
      else refund_incidents.resolved_at
    end
  returning id, status, retry_count
  into v_incident_id, v_status, v_retry_count;

  -- attempt_number : retry_count pour les échecs (le N-ième échec = attempt#N) ;
  -- retry_count + 1 pour les succès (le succès consomme un slot sans
  -- incrémenter retry_count).
  v_attempt_number := case
    when p_outcome = 'succeeded' then v_retry_count + 1
    else v_retry_count
  end;

  insert into public.refund_incident_attempts (
    refund_incident_id,
    attempt_number,
    outcome,
    stripe_error_code,
    stripe_error_type,
    stripe_error_message,
    stripe_request_id,
    stripe_refund_id
  )
  values (
    v_incident_id,
    v_attempt_number,
    p_outcome,
    p_stripe_error_code,
    p_stripe_error_type,
    p_stripe_error_message,
    p_stripe_request_id,
    p_stripe_refund_id
  )
  returning id into v_attempt_id;

  return query select v_incident_id, v_status, v_attempt_id, v_attempt_number;
end;
$$;

comment on function public.record_refund_attempt is
  'RPC atomique T-102.2.b : UPSERT refund_incidents + INSERT refund_incident_attempts. Court-circuit status=exhausted si classification=permanent. Réutilisée par T-102.2.c (helper retry).';

commit;
