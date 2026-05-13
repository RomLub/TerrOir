-- =============================================================================
-- PR2 admin dashboard (audit pré-launch 2026-05-13) — RPC consolidée
-- `get_admin_dashboard()` pour la page `app/(admin)/tableau-de-bord/page.tsx`
-- =============================================================================
-- Avant : page (admin)/tableau-de-bord/page.tsx contient 8 lignes (juste un
-- `<h1>Back-office</h1>`). Le point d'entrée admin ne pilote rien.
--
-- Après : 1 RPC SECDEF consolidée, retourne un JSON 3-zones consommé par
-- un Server Component unique (`createSupabaseAdminClient().rpc(...)`).
--
-- Pattern : strictement aligné sur `get_producer_dashboard` (F-045, migration
-- 20260511101000) — même style commentaire, même `SET search_path`, même
-- ACL (REVOKE PUBLIC, GRANT service_role uniquement). Différences :
--   - Pas de paramètres : la fonction ne dépend que de `now()` et des
--     enums DB. Toutes les fenêtres sont calculées côté SQL (today =
--     calendar day Paris ; 7d = rolling 7 days UTC ; 30d = rolling 30 days
--     UTC pour le funnel invitations).
--   - `STABLE` car ne fait que des SELECT.
--   - `language sql` (pas plpgsql) car pas de logique conditionnelle.
--
-- Auth interne : la RPC est SECURITY DEFINER. Caller = service_role exclusif
-- (createSupabaseAdminClient côté SSR Next, jamais exposé browser). EXECUTE
-- révoqué de PUBLIC + anon + authenticated. Cohérent avec doctrine
-- service_role-only des RPCs admin consommées en SSR (T-218 + F-001 + F-045).
--
-- Contrat JSON retourné — 3 zones (clés snake_case) :
--
--   {
--     "cockpit": {
--       "refunds_pending_count": int,
--       "disputes_open_count": int,
--       "reviews_pending_count": int,
--       "producers_pending_validation_count": int,
--       "refund_incidents_count": int,
--       "invitations_expired_count": int
--     },
--     "business": {
--       "orders_today_count": int,
--       "revenue_today_cents": int,
--       "new_users_today_count": int,
--       "orders_7d_count": int,
--       "revenue_7d_cents": int,
--       "completion_rate_7d": numeric (0..100, 1 décimale),
--       "active_producers_7d": int,
--       "total_producers": int,
--       "invitation_conversion_30d": {
--         "invitations_sent": int,
--         "onboardings_completed": int,
--         "rate_pct": numeric or null  -- null si invitations_sent = 0
--       }
--     },
--     "recent_events": [
--       { "id": uuid, "event_type": text, "user_id": uuid|null,
--         "metadata": jsonb, "created_at": timestamptz }
--     ]  -- 15 derniers events whitelist, DESC
--   }
--
-- Whitelist Zone 3 (recent_events) — events business pertinents pour le
-- pilotage admin, vérifiés contre `app/(admin)/audit-logs/_lib/event-types.ts` :
--   - order_created                 : commande créée
--   - pickup_validated              : commande retirée (= "completed")
--   - order_cancelled               : commande annulée
--   - order_payment_succeeded       : paiement validé Stripe (high-value)
--   - account_signup                : inscription consumer/producer
--   - account_login_magic_link      : login magic link consommé
--   - admin_invite_sent             : invitation envoyée (admin)
--   - invitation_consumed_success   : invitation utilisée (onboarding OK)
--   - producer_response_published   : producteur a répondu à un avis
--
-- Convention montants : tous les `*_cents` sont des entiers (centimes EUR).
-- Conversion depuis `orders.montant_total` (numeric en euros) via `* 100`.
--
-- Fuseau horaire : "aujourd'hui" = calendar day Paris. Calculé via
-- `(now() AT TIME ZONE 'Europe/Paris')::date` → start_of_day Paris en
-- timestamptz via `(d::timestamp) AT TIME ZONE 'Europe/Paris'`. Gère DST
-- automatiquement (Postgres applique la règle TZ à l'instant donné).
--
-- Forward-only : pas de migration retour back compat — le ship code TS
-- (lib/admin/dashboard/* + page.tsx) accompagne l'apply de cette migration.
-- =============================================================================

create or replace function public.get_admin_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
    -- ─── Bornes temporelles (calcul SQL pur, pas de paramètre) ─────────
    bounds as (
      select
        ((now() at time zone 'Europe/Paris')::date::timestamp
          at time zone 'Europe/Paris') as today_start_utc,
        (((now() at time zone 'Europe/Paris')::date + 1)::timestamp
          at time zone 'Europe/Paris') as tomorrow_start_utc,
        (now() - interval '7 days') as week_ago_utc,
        (now() - interval '30 days') as thirty_days_ago_utc
    ),

    -- ─── ZONE 1 : cockpit (compteurs d'attention) ──────────────────────
    refunds_pending as (
      select count(*)::int as c
      from public.pending_refunds
      where status = 'pending'
    ),
    disputes_open as (
      -- "Ouverts" = closed_at IS NULL (cohérent avec idx disputes_status_open_idx
      -- migration 20260429020000 ligne 63-65). Couvre needs_response,
      -- under_review, warning_needs_response, warning_under_review — exclut
      -- won/lost/warning_closed qui posent closed_at via handle-dispute-closed.
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
      -- 'pending' = producteur a complété l'onboarding et attend décision
      -- admin (validation → 'active' ou rejet → 'suspended'). 'draft' n'est
      -- PAS inclus : c'est un onboarding en cours côté producteur, pas une
      -- demande de validation admin.
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
      -- producer_invitations n'a pas de colonne `status` : "expirée" =
      -- jamais consommée (used_at IS NULL) ET deadline passée.
      select count(*)::int as c
      from public.producer_invitations
      where used_at is null
        and expires_at < now()
    ),

    -- ─── ZONE 2 : santé business ───────────────────────────────────────
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
      -- Active = au moins 1 order CRÉÉE dans la fenêtre (peu importe le
      -- statut). Couvre le producer qui reçoit du trafic même si toutes
      -- ses orders 7j ont été annulées.
      select count(distinct producer_id)::int as c
      from public.orders, bounds
      where created_at >= bounds.week_ago_utc
    ),
    total_producers as (
      -- Visible côté consumer = statut IN ('active', 'public'). Cohérent
      -- avec le filtrage search_producers (migration 20260422000000).
      select count(*)::int as c
      from public.producers
      where statut in ('active', 'public')
        and deleted_at is null
    ),
    invitation_conversion_30d as (
      -- Cohérent avec lib/audit-logs/invitation-conversion-stats.ts : pas
      -- de cohorte stricte (un onboarding aujourd'hui peut découler d'une
      -- invitation > 30j). Acceptable pré-Live volumes faibles.
      select
        (select count(*)::int from public.audit_logs, bounds
         where event_type = 'admin_invite_sent'
           and created_at >= bounds.thirty_days_ago_utc) as sent,
        (select count(*)::int from public.audit_logs, bounds
         where event_type = 'invitation_consumed_success'
           and created_at >= bounds.thirty_days_ago_utc) as completed
    ),

    -- ─── ZONE 3 : activité récente (whitelist 15 derniers) ─────────────
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
      'invitations_expired_count', (select c from invitations_expired)
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
$$;

revoke execute on function public.get_admin_dashboard() from public, anon, authenticated;
grant execute on function public.get_admin_dashboard() to service_role;

comment on function public.get_admin_dashboard is
  'PR2 admin dashboard (audit pré-launch 2026-05-13) — RPC consolidée TdB admin. '
  'Retourne JSONB 3-zones (cockpit / business / recent_events). '
  'Contrat : service_role-only (createSupabaseAdminClient côté SSR Next).';
