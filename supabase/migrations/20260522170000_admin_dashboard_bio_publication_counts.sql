-- Chantier 3 Phase 6 — ajout de deux compteurs cockpit au dashboard admin :
--   publications_pending_count : demandes de publication en attente
--   bio_pending_count          : certifications bio déclarées non validées
--
-- CREATE OR REPLACE additif (2 CTEs + 2 champs jsonb dans `cockpit`). Le reste
-- de la fonction est repris à l'identique de la définition live (récupérée via
-- pg_get_functiondef) pour éviter toute dérive.

create or replace function public.get_admin_dashboard()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with
    bounds as (
      select
        ((now() at time zone 'Europe/Paris')::date::timestamp
          at time zone 'Europe/Paris') as today_start_utc,
        (((now() at time zone 'Europe/Paris')::date + 1)::timestamp
          at time zone 'Europe/Paris') as tomorrow_start_utc,
        (now() - interval '7 days') as week_ago_utc,
        (now() - interval '30 days') as thirty_days_ago_utc
    ),
    refunds_pending as (
      select count(*)::int as c
      from public.pending_refunds
      where status = 'pending'
    ),
    disputes_open as (
      select count(*)::int as c
      from public.disputes
      where closed_at is null
    ),
    reviews_pending as (
      select count(*)::int as c
      from public.reviews
      where statut = 'pending'
    ),
    producers_pending_validation as (
      select count(*)::int as c
      from public.producers
      where statut = 'pending'
        and deleted_at is null
    ),
    refund_incidents_active as (
      select count(*)::int as c
      from public.refund_incidents
      where status in ('pending', 'retrying')
    ),
    invitations_expired as (
      select count(*)::int as c
      from public.producer_invitations
      where used_at is null
        and expires_at < now()
    ),
    -- Chantier 3 : demandes de publication en attente (non publiées).
    publications_pending as (
      select count(*)::int as c
      from public.producers
      where publication_requested_at is not null
        and statut <> 'public'
        and deleted_at is null
    ),
    -- Chantier 3 : certifications bio déclarées en attente de validation admin.
    bio_pending as (
      select count(*)::int as c
      from public.producers
      where bio = true
        and bio_validated_at is null
        and deleted_at is null
    ),
    orders_today as (
      select
        count(*)::int as cnt,
        coalesce(sum(case when statut = 'completed'
                          then round(montant_total * 100)::bigint
                          else 0 end), 0)::bigint as revenue_cents
      from public.orders, bounds
      where created_at >= bounds.today_start_utc
        and created_at < bounds.tomorrow_start_utc
    ),
    new_users_today as (
      select count(*)::int as cnt
      from public.users, bounds
      where created_at >= bounds.today_start_utc
        and created_at < bounds.tomorrow_start_utc
    ),
    orders_7d as (
      select
        count(*)::int as cnt,
        count(*) filter (where statut = 'completed')::int as completed_cnt,
        coalesce(sum(case when statut = 'completed'
                          then round(montant_total * 100)::bigint
                          else 0 end), 0)::bigint as revenue_cents
      from public.orders, bounds
      where created_at >= bounds.week_ago_utc
    ),
    active_producers_7d as (
      select count(distinct producer_id)::int as c
      from public.orders, bounds
      where created_at >= bounds.week_ago_utc
    ),
    total_producers as (
      select count(*)::int as c
      from public.producers
      where statut in ('active', 'public')
        and deleted_at is null
    ),
    invitation_conversion_30d as (
      select
        (select count(*)::int from public.audit_logs, bounds
         where event_type = 'admin_invite_sent'
           and created_at >= bounds.thirty_days_ago_utc) as sent,
        (select count(*)::int from public.audit_logs, bounds
         where event_type = 'invitation_consumed_success'
           and created_at >= bounds.thirty_days_ago_utc) as completed
    ),
    recent_events as (
      select id, event_type, user_id, metadata, created_at
      from public.audit_logs
      where event_type in (
        'order_created',
        'pickup_validated',
        'order_cancelled',
        'order_payment_succeeded',
        'account_signup',
        'account_login_magic_link',
        'admin_invite_sent',
        'invitation_consumed_success',
        'producer_response_published'
      )
      order by created_at desc, id desc
      limit 15
    )
  select jsonb_build_object(
    'cockpit', jsonb_build_object(
      'refunds_pending_count', (select c from refunds_pending),
      'disputes_open_count', (select c from disputes_open),
      'reviews_pending_count', (select c from reviews_pending),
      'producers_pending_validation_count',
        (select c from producers_pending_validation),
      'refund_incidents_count', (select c from refund_incidents_active),
      'invitations_expired_count', (select c from invitations_expired),
      'publications_pending_count', (select c from publications_pending),
      'bio_pending_count', (select c from bio_pending)
    ),
    'business', jsonb_build_object(
      'orders_today_count', (select cnt from orders_today),
      'revenue_today_cents', (select revenue_cents from orders_today),
      'new_users_today_count', (select cnt from new_users_today),
      'orders_7d_count', (select cnt from orders_7d),
      'revenue_7d_cents', (select revenue_cents from orders_7d),
      'completion_rate_7d', (
        select case when (select cnt from orders_7d) > 0
                    then round(
                      ((select completed_cnt from orders_7d)::numeric
                        / (select cnt from orders_7d)::numeric) * 1000
                    ) / 10
                    else 0 end
      ),
      'active_producers_7d', (select c from active_producers_7d),
      'total_producers', (select c from total_producers),
      'invitation_conversion_30d', jsonb_build_object(
        'invitations_sent', (select sent from invitation_conversion_30d),
        'onboardings_completed',
          (select completed from invitation_conversion_30d),
        'rate_pct', (
          select case when (select sent from invitation_conversion_30d) > 0
                      then round(
                        ((select completed from invitation_conversion_30d)::numeric
                          / (select sent from invitation_conversion_30d)::numeric)
                        * 1000
                      ) / 10
                      else null end
        )
      )
    ),
    'recent_events', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'event_type', event_type,
          'user_id', user_id,
          'metadata', metadata,
          'created_at', created_at
        )
        order by created_at desc, id desc
      ) from recent_events),
      '[]'::jsonb
    )
  );
$function$;
