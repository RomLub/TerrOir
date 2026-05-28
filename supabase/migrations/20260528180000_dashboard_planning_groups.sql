-- =============================================================================
-- TerrOir — Dashboard planning : regroupement par "plage paramétrée" (2026-05-28)
-- =============================================================================
-- Refonte du calendrier dashboard producteur (vertical, remplace le bandeau
-- heatmap horizontal de la migration `20260528120000`). Le nouveau composant
-- VerticalWeekCalendar regroupe les slots en "plages paramétrées" :
--   - slots issus d'une slot_rule  → groupés par (rule_id, date locale)
--   - slots ponctuels (rule_id NULL) → groupés par contiguïté horaire
-- Sur chaque plage, le front affiche "X commandes" et, au clic, la liste
-- des commandes (heure du créneau + code TRR-XXXXX + lien /commandes/[id]).
--
-- Cette migration enrichit la CTE `slots_rows` de get_producer_dashboard
-- avec deux champs additionnels par slot :
--   1. `rule_id` (uuid, nullable) : clé de grouping côté client. NULL pour
--      les slots ponctuels (regroupés alors par contiguïté).
--   2. `orders` (jsonb array) : liste des commandes attachées au slot,
--      filtrée sur les MÊMES statuts que `orders_count` (pending, confirmed,
--      ready). Chaque entrée = `{order_id, code_commande, starts_at}`.
--      `starts_at` est dénormalisé depuis le slot (l'heure de la commande
--      = l'heure du slot par construction, cf. orders.slot_id).
--
-- Invariant garanti côté SQL : `jsonb_array_length(orders) = orders_count`
-- (même WHERE statut sur les deux). Le test composant le vérifie côté front.
--
-- ⚠️ ADDITIVE / FORWARD-ONLY :
-- Les champs ajoutés (`rule_id`, `orders`) ne sont pas lus par le code
-- déployé. Le composant WeekPlanningHeatmap actuel n'utilise QUE les
-- champs pré-existants (id, starts_at, ends_at, capacity_per_slot,
-- orders_count). Cette RPC est donc dormante en prod tant que le composant
-- VerticalWeekCalendar n'est pas déployé → applicable AVANT merge via MCP
-- sans risque (cf. CLAUDE.md §8 "Migrations — moment d'application en prod").
--
-- Tous les autres champs du payload (user, orders_today, week_orders,
-- producer_row, pending_orders, upcoming_orders, week_pickups,
-- week_open_days, low_stock_products) sont préservés à l'identique.
-- `week_open_days` reste exposé en sortie mais n'est plus consommé par le
-- nouveau composant (la spec Claude Design abolit la notion ouvert/fermé).
--
-- Forward-only, idempotent via `create or replace function`. GRANT
-- préservés (service_role-only, cohérent migration 20260511101000).
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
    -- slots_rows : enrichi avec rule_id (clé de grouping côté client) et
    -- orders[] (détail tooltip). Le filtre statut IN (pending, confirmed,
    -- ready) est strictement identique pour orders_count et orders →
    -- invariant `jsonb_array_length(orders) = orders_count` garanti par
    -- construction. starts_at dans chaque order est dénormalisé depuis le
    -- slot pour éviter au front d'avoir à matcher slot↔order.
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
          and o.statut in ('pending', 'confirmed', 'ready')
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
    -- week_open_days conservé (additif) mais n'est plus consommé par le
    -- nouveau composant VerticalWeekCalendar. Maintenu pour rétro-compat
    -- pendant la fenêtre de déploiement.
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

-- GRANT préservés par `create or replace function` : service_role-only.

comment on function public.get_producer_dashboard is
  'F-045 + chantier vertical week calendar (2026-05-28) — RPC consolidée dashboard producer. '
  'Ajoute rule_id + orders[] par slot (regroupement par plage paramétrée côté client). '
  'Conserve capacity_per_slot, orders_count, week_open_days[7]. '
  'Contrat : service_role-only (l''app vérifie l''ownership en amont).';
