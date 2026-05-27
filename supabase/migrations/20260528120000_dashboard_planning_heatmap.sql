-- =============================================================================
-- TerrOir — Refonte Planning de la semaine : payload heatmap (2026-05-28)
-- =============================================================================
-- Chantier "Planning de la semaine — heatmap bandeau" : refonte UI du
-- dashboard producteur (cf. WeekPlanningHeatmap), qui exige un payload
-- plus riche que la version actuelle de get_producer_dashboard.
--
-- Trois changements ciblés dans la RPC :
--   1. slots_rows : ajoute le filtre `excluded_at IS NULL` (bug latent
--      pré-existant : les slots exclus apparaissaient dans le payload).
--   2. slots_rows : expose `capacity_per_slot` et `orders_count` (agrégat
--      pending+confirmed+ready sur orders.slot_id) → nourrit le segment
--      heatmap "X/Y réservés" sans deuxième pass côté Next.
--   3. Nouveau champ `week_open_days boolean[7]` (index 0=Lun → 6=Dim) :
--      un jour est "ouvert" ssi (a) au moins une slot_rule active couvre
--      ce day-of-week, OU (b) au moins un slot ponctuel (rule_id IS NULL)
--      ce jour-là dans la semaine consultée. Permet au front de distinguer
--      "fermé" (gris hachuré) de "ouvert mais aucun créneau" (vert plat).
--
-- Convention `slot_rules.days_of_week` : entiers 0-6, **0=dimanche, 1=lundi,
-- ..., 6=samedi** (aligné `Date.prototype.getDay()` JS, cf.
-- `lib/slots/generate.ts:88` `day.getDay()`). Le mapping vers le tableau
-- Lun→Dim du front est : `js_dow_for_index(i) = (i + 1) % 7`.
--
-- Comportement assumé pour les semaines passées : `week_open_days` reflète
-- l'état *actuel* des slot_rules (pas d'historisation des règles). Si un
-- producteur a désactivé toutes ses règles, ses semaines passées
-- apparaîtront "fermées partout". C'est la seule vérité disponible —
-- l'historisation rétroactive serait un autre chantier.
--
-- Forward-only, idempotent via `create or replace function`. Préserve les
-- GRANT existants (service_role only, cf. migration 20260511101000).
-- ⚠️ RETURN-SHAPE CHANGE : à apply APRÈS le déploiement du code Next qui
-- consomme les nouveaux champs (CLAUDE.md piège chantier 2). Le code TS
-- a un fallback robuste (`?? 1`, `?? 0`, `?? [true × 7]`) pendant la
-- fenêtre déploiement.
-- =============================================================================

create or replace function public.get_producer_dashboard(
  p_producer_id uuid,
  p_today_start timestamptz,
  p_yesterday_start timestamptz,
  p_tomorrow_start timestamptz,
  p_week_start timestamptz,
  p_week_end timestamptz,
  p_last_week_start timestamptz,
  p_slots_range_start timestamptz,
  p_slots_range_end timestamptz,
  p_user_id uuid,
  p_today_iso date,
  p_week_start_iso date,
  p_week_end_iso date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  with
    user_row as (
      select prenom, nom
      from public.users
      where id = p_user_id
    ),
    orders_today_cnt as (
      select count(*)::int as c
      from public.orders
      where producer_id = p_producer_id
        and created_at >= p_today_start
        and created_at < p_tomorrow_start
    ),
    orders_yesterday_cnt as (
      select count(*)::int as c
      from public.orders
      where producer_id = p_producer_id
        and created_at >= p_yesterday_start
        and created_at < p_today_start
    ),
    week_orders as (
      select id, montant_total, statut
      from public.orders
      where producer_id = p_producer_id
        and created_at >= p_week_start
        and created_at < p_week_end
    ),
    last_week_orders as (
      select montant_total, statut
      from public.orders
      where producer_id = p_producer_id
        and created_at >= p_last_week_start
        and created_at < p_week_start
    ),
    producer_row as (
      select note_moyenne, nb_avis,
             badge_stock_score, badge_confirmation_score, badge_annulation_score
      from public.producers
      where id = p_producer_id
    ),
    pending_raw as (
      select
        o.id, o.code_commande, o.created_at, o.montant_total, o.date_retrait,
        jsonb_build_object('prenom', c.prenom) as consumer,
        case when s.id is null then null
             else jsonb_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at)
        end as slot,
        coalesce(
          (
            select jsonb_agg(jsonb_build_object('nom', p.nom))
            from public.order_items oi
            join public.products p on p.id = oi.product_id
            where oi.order_id = o.id
          ),
          '[]'::jsonb
        ) as order_items
      from public.orders o
      left join public.users c on c.id = o.consumer_id
      left join public.slots s on s.id = o.slot_id
      where o.producer_id = p_producer_id
        and o.statut = 'pending'
      order by o.created_at asc
      limit 5
    ),
    upcoming_raw as (
      select
        o.id, o.code_commande, o.heure_retrait, o.date_retrait,
        jsonb_build_object('prenom', c.prenom) as consumer
      from public.orders o
      left join public.users c on c.id = o.consumer_id
      where o.producer_id = p_producer_id
        and o.statut = 'confirmed'
        and o.date_retrait >= p_today_iso
      order by o.date_retrait asc, o.heure_retrait asc
      limit 1
    ),
    -- (1) + (2) : excluded_at filtré, capacity_per_slot + orders_count
    -- exposés. Le orders_count agrège les statuts "réservés actifs"
    -- (pending + confirmed + ready) ; refunded et cancelled sont exclus
    -- — ils libèrent la capacité.
    slots_rows as (
      select
        s.id,
        s.starts_at,
        s.ends_at,
        s.capacity_per_slot,
        coalesce(o_cnt.cnt, 0)::int as orders_count
      from public.slots s
      left join lateral (
        select count(*)::int as cnt
        from public.orders o
        where o.slot_id = s.id
          and o.statut in ('pending', 'confirmed', 'ready')
      ) o_cnt on true
      where s.producer_id = p_producer_id
        and s.active = true
        and s.excluded_at is null
        and s.starts_at >= p_slots_range_start
        and s.starts_at < p_slots_range_end
    ),
    week_pickups as (
      select date_retrait, slot_id, statut
      from public.orders
      where producer_id = p_producer_id
        and date_retrait >= p_week_start_iso
        and date_retrait < p_week_end_iso
    ),
    -- (3) week_open_days : tableau bool[7] indexé Lun→Dim (index 0=Lun).
    -- Mapping vers JS dow : js_dow = (i + 1) % 7.
    --   index 0 (Lun) → js_dow 1
    --   index 6 (Dim) → js_dow 0
    -- "Ouvert" = au moins une slot_rule active sur ce js_dow OU au moins
    -- un slot ponctuel (rule_id IS NULL, non exclu, actif) ce jour-là.
    week_open_days_arr as (
      select array(
        select
          exists (
            select 1
            from public.slot_rules sr
            where sr.producer_id = p_producer_id
              and sr.active = true
              and ((i + 1) % 7)::smallint = any(sr.days_of_week)
          )
          or exists (
            select 1
            from public.slots s
            where s.producer_id = p_producer_id
              and s.rule_id is null
              and s.active = true
              and s.excluded_at is null
              and (s.starts_at at time zone 'Europe/Paris')::date
                  = p_week_start_iso + i
          )
        from generate_series(0, 6) as i
      ) as days
    ),
    low_stock as (
      select id, nom, stock_disponible, stock_illimite
      from public.products
      where producer_id = p_producer_id
        and active = true
        and stock_illimite = false
        and stock_disponible <= 5
        and stock_disponible > 0
      limit 3
    )
  select jsonb_build_object(
    'user', (select to_jsonb(u) from user_row u),
    'orders_today', (select c from orders_today_cnt),
    'orders_yesterday', (select c from orders_yesterday_cnt),
    'week_orders', coalesce((select jsonb_agg(to_jsonb(w)) from week_orders w), '[]'::jsonb),
    'last_week_orders', coalesce((select jsonb_agg(to_jsonb(l)) from last_week_orders l), '[]'::jsonb),
    'producer_row', (select to_jsonb(p) from producer_row p),
    'pending_orders', coalesce((select jsonb_agg(to_jsonb(pr)) from pending_raw pr), '[]'::jsonb),
    'upcoming_orders', coalesce((select jsonb_agg(to_jsonb(ur)) from upcoming_raw ur), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(to_jsonb(s)) from slots_rows s), '[]'::jsonb),
    'week_pickups', coalesce((select jsonb_agg(to_jsonb(wp)) from week_pickups wp), '[]'::jsonb),
    'week_open_days', (select to_jsonb(days) from week_open_days_arr),
    'low_stock_products', coalesce((select jsonb_agg(to_jsonb(ls)) from low_stock ls), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- Les GRANT sont préservés par `create or replace function` (cohérent
-- migration 20260511101000) : service_role-only. Pas besoin de re-grant.

comment on function public.get_producer_dashboard is
  'F-045 + chantier heatmap planning (2026-05-28) — RPC consolidée dashboard producer. '
  'Ajoute capacity_per_slot + orders_count par slot, week_open_days[7] (Lun→Dim), '
  'et filtre excluded_at sur slots. Contrat : service_role-only (l''app vérifie l''ownership en amont).';
