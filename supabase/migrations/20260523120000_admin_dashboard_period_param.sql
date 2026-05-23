-- Chantier 2 — Dashboard admin refonte : RPC get_admin_dashboard paramétrée
-- par période (bandeau temporel Aujourd'hui / Cette semaine / Ce mois-ci /
-- Cette année).
--
-- Changements :
--   - Signature : () → (p_period text default 'today'). DROP + CREATE.
--   - Nouveau bloc `period` (4 KPIs sur la période : commandes, CA, comptes
--     consommateurs actifs = distinct consumer_id ayant commandé, comptes
--     producteurs actifs = distinct producer_id ayant reçu une commande).
--     Bornes calculées en Europe/Paris via date_trunc selon p_period.
--   - Suppression du bloc `business` today/7d (remplacé par le bandeau période
--     côté UI). La conversion invitations 30j est promue au top-level
--     `conversion_30d` (zone dédiée).
--   - cockpit (incl. publications/bio chantier 3) + recent_events inchangés.
--
-- Forward-only. Re-grant execute service_role (seul appelant : fetchAdminDashboard
-- via createSupabaseAdminClient).

drop function if exists public.get_admin_dashboard();

create function public.get_admin_dashboard(p_period text default 'today')
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with
    period_bounds as (
      select
        case p_period
          when 'week'  then (date_trunc('week',  now() at time zone 'Europe/Paris')::timestamp at time zone 'Europe/Paris')
          when 'month' then (date_trunc('month', now() at time zone 'Europe/Paris')::timestamp at time zone 'Europe/Paris')
          when 'year'  then (date_trunc('year',  now() at time zone 'Europe/Paris')::timestamp at time zone 'Europe/Paris')
          else ((now() at time zone 'Europe/Paris')::date::timestamp at time zone 'Europe/Paris')
        end as p_start,
        case p_period
          when 'week'  then ((date_trunc('week',  now() at time zone 'Europe/Paris') + interval '7 days')::timestamp at time zone 'Europe/Paris')
          when 'month' then ((date_trunc('month', now() at time zone 'Europe/Paris') + interval '1 month')::timestamp at time zone 'Europe/Paris')
          when 'year'  then ((date_trunc('year',  now() at time zone 'Europe/Paris') + interval '1 year')::timestamp at time zone 'Europe/Paris')
          else (((now() at time zone 'Europe/Paris')::date + 1)::timestamp at time zone 'Europe/Paris')
        end as p_end
    ),
    period as (
      select
        count(*)::int as orders_count,
        coalesce(sum(case when o.statut = 'completed' then round(o.montant_total * 100)::bigint else 0 end), 0)::bigint as revenue_cents,
        count(distinct o.consumer_id)::int as active_consumers,
        count(distinct o.producer_id)::int as active_producers
      from public.orders o, period_bounds pb
      where o.created_at >= pb.p_start and o.created_at < pb.p_end
    ),
    conv_bounds as (select (now() - interval '30 days') as thirty_days_ago_utc),
    refunds_pending as (select count(*)::int as c from public.pending_refunds where status = 'pending'),
    disputes_open as (select count(*)::int as c from public.disputes where closed_at is null),
    reviews_pending as (select count(*)::int as c from public.reviews where statut = 'pending'),
    producers_pending_validation as (select count(*)::int as c from public.producers where statut = 'pending' and deleted_at is null),
    refund_incidents_active as (select count(*)::int as c from public.refund_incidents where status in ('pending', 'retrying')),
    invitations_expired as (select count(*)::int as c from public.producer_invitations where used_at is null and expires_at < now()),
    publications_pending as (select count(*)::int as c from public.producers where publication_requested_at is not null and statut <> 'public' and deleted_at is null),
    bio_pending as (select count(*)::int as c from public.producers where bio = true and bio_validated_at is null and deleted_at is null),
    invitation_conversion_30d as (
      select
        (select count(*)::int from public.audit_logs, conv_bounds where event_type = 'admin_invite_sent' and created_at >= conv_bounds.thirty_days_ago_utc) as sent,
        (select count(*)::int from public.audit_logs, conv_bounds where event_type = 'invitation_consumed_success' and created_at >= conv_bounds.thirty_days_ago_utc) as completed
    ),
    recent_events as (
      select id, event_type, user_id, metadata, created_at
      from public.audit_logs
      where event_type in ('order_created','pickup_validated','order_cancelled','order_payment_succeeded','account_signup','account_login_magic_link','admin_invite_sent','invitation_consumed_success','producer_response_published')
      order by created_at desc, id desc
      limit 15
    )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'orders_count', (select orders_count from period),
      'revenue_cents', (select revenue_cents from period),
      'active_consumers', (select active_consumers from period),
      'active_producers', (select active_producers from period)
    ),
    'cockpit', jsonb_build_object(
      'refunds_pending_count', (select c from refunds_pending),
      'disputes_open_count', (select c from disputes_open),
      'reviews_pending_count', (select c from reviews_pending),
      'producers_pending_validation_count', (select c from producers_pending_validation),
      'refund_incidents_count', (select c from refund_incidents_active),
      'invitations_expired_count', (select c from invitations_expired),
      'publications_pending_count', (select c from publications_pending),
      'bio_pending_count', (select c from bio_pending)
    ),
    'conversion_30d', jsonb_build_object(
      'invitations_sent', (select sent from invitation_conversion_30d),
      'onboardings_completed', (select completed from invitation_conversion_30d),
      'rate_pct', (select case when (select sent from invitation_conversion_30d) > 0 then round(((select completed from invitation_conversion_30d)::numeric / (select sent from invitation_conversion_30d)::numeric) * 1000) / 10 else null end)
    ),
    'recent_events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'event_type', event_type, 'user_id', user_id, 'metadata', metadata, 'created_at', created_at) order by created_at desc, id desc) from recent_events), '[]'::jsonb)
  );
$function$;

grant execute on function public.get_admin_dashboard(text) to service_role;
