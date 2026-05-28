-- =============================================================================
-- TerrOir — Cleanup : retire le statut orphelin 'ready' de get_producer_dashboard
-- =============================================================================
-- Le statut 'ready' a été retiré du CHECK orders.statut le 2026-05-07
-- (migration 20260507B00000_cluster_c_drop_ready_status.sql). La RPC
-- get_producer_dashboard contient encore une référence orpheline à 'ready'
-- dans son filtre `o.statut in ('pending', 'confirmed', 'ready')` (CTE
-- slots_rows, migration 20260528180000).
--
-- Impact pratique : nul (la CHECK empêche toute insertion 'ready', donc le
-- WHERE ne matche jamais). Cleanup pour cohérence / lisibilité.
--
-- Forward-only / idempotent : `create or replace function` préserve les
-- GRANT (service_role-only) et le contrat de retour. Toutes les autres
-- branches de la RPC sont reprises à l'identique de la version 20260528180000.
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
    -- slots_rows : filtre statut sur ('pending', 'confirmed') (le statut
    -- 'ready' a été retiré du CHECK orders.statut le 2026-05-07). Invariant
    -- `jsonb_array_length(orders) = orders_count` préservé (même WHERE statut
    -- pour les deux agrégats).
    slots_rows as (
      select
        s.id,
        s.starts_at,
        s.ends_at,
        s.capacity_per_slot,
        s.rule_id,
        coalesce(o_agg.cnt, 0)::int as orders_count,
        coalesce(o_agg.list, '[]'::jsonb) as orders
      from public.slots s
      left join lateral (
        select
          count(*)::int as cnt,
          jsonb_agg(
            jsonb_build_object(
              'order_id', o.id,
              'code_commande', o.code_commande,
              'starts_at', s.starts_at
            )
            order by o.code_commande
          ) as list
        from public.orders o
        where o.slot_id = s.id
          and o.statut in ('pending', 'confirmed')
      ) o_agg on true
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

comment on function public.get_producer_dashboard is
  'F-045 + chantier vertical week calendar (2026-05-28) — RPC consolidée dashboard producer. '
  'Filtre orders sur (pending, confirmed) — statut "ready" retiré du CHECK depuis 2026-05-07. '
  'Expose rule_id + orders[] par slot (regroupement par plage paramétrée côté client). '
  'Contrat : service_role-only (l''app vérifie l''ownership en amont).';
