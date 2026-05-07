-- =============================================================================
-- TerrOir — extension enum refund_incidents.kind avec 'manual_cancel'
-- =============================================================================
-- Cluster B Phase 3 (bugs-P1-1 + bugs-P1-4) : aligne `cancel/route.tsx` sur
-- le pattern T-102.2.b (recordRefundAttempt sur refund failed). La route
-- cancel emet un refund Stripe mais ne posait aucune trace `refund_incidents`
-- sur echec → le cron `retry-failed-refunds` etait aveugle aux refunds rates
-- depuis ce path.
--
-- Strategie : ajout d'un 4eme kind 'manual_cancel' (vs reuse de 'admin' qui
-- discrimine deja le path /api/stripe/refund). Garde la separation des paths
-- pour dashboards + retry telemetrie.
--
-- Migrations touchees :
--   1. CHECK constraint refund_incidents.kind : whitelist etendue
--   2. Validation RPC public.record_refund_attempt : whitelist etendue
--
-- Forward-only convention (cf. CLAUDE.md doctrine migrations) : DROP +
-- recreation du CHECK constraint via ALTER TABLE (pas de bump CHECK
-- in-place possible en Postgres). RPC : CREATE OR REPLACE atomique.
--
-- Cron consumer : `app/api/cron/retry-failed-refunds/route.ts` accepte deja
-- tout kind retourne par la query refund_incidents (pas de filtre WHERE
-- kind=...), via le helper lib/refund-incidents/retry-incident.ts qui derive
-- l'idempotency key depuis le kind. Pas de modif cote cron.
-- =============================================================================

begin;

alter table public.refund_incidents
  drop constraint if exists refund_incidents_kind_check;

alter table public.refund_incidents
  add constraint refund_incidents_kind_check
  check (kind in ('revival', 'admin', 'timeout', 'manual_cancel'));

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
  if p_kind not in ('revival', 'admin', 'timeout', 'manual_cancel') then
    raise exception 'invalid kind: %', p_kind using errcode = '22023';
  end if;
  if p_outcome not in ('failed', 'succeeded') then
    raise exception 'invalid outcome: %', p_outcome using errcode = '22023';
  end if;
  if p_classification is not null
     and p_classification not in ('safe_to_retry', 'permanent', 'unknown') then
    raise exception 'invalid classification: %', p_classification using errcode = '22023';
  end if;

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
  'RPC atomique T-102.2.b : UPSERT refund_incidents + INSERT refund_incident_attempts. Court-circuit status=exhausted si classification=permanent. 2026-05-07 : whitelist kind etendue avec manual_cancel (cancel/route.tsx).';

commit;
