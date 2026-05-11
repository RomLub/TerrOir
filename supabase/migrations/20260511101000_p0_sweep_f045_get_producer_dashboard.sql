-- =============================================================================
-- F-045 (audit pré-launch 2026-05-11) — RPC consolidée producer dashboard
-- =============================================================================
-- Avant : page (producer)/dashboard/page.tsx exécutait 11 queries
-- Promise.all() à chaque request. À 50 producers actifs polling = pic
-- 550 connexions parallèles vers le pooler Supabase (limite transaction
-- pooler 200).
--
-- Après : une seule RPC SECDEF `get_producer_dashboard(p_producer_id, ...)`
-- retournant un JSONB consolidé. Les 11 queries deviennent 11 SELECT
-- séquentiels mais dans une SEULE transaction côté pooler = 1 conn slot
-- par request au lieu de 11.
--
-- Auth interne : la RPC est SECURITY DEFINER. Elle doit valider que le
-- caller est admin OU owner du p_producer_id. Convention TerrOir : caller
-- = service_role uniquement (le call site est `createSupabaseAdminClient`
-- côté SSR Next, jamais exposé client-side). On NE valide PAS l'identité
-- producer côté SQL — le contrat est "service_role-only, l'app vérifie
-- déjà l'ownership via fetchProducerForUser AVANT d'appeler la RPC".
-- EXECUTE révoqué de PUBLIC + anon + authenticated, GRANT à service_role
-- exclusivement (cohérent doctrine T-218 + F-001).
--
-- Forward-only : remplace les 11 queries inline du page server component.
-- Pas de migration retour back compat — le ship code TS doit accompagner
-- l'apply de cette migration (cf. dashboard/page.tsx commit associé).
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
    slots_rows as (
      select id, starts_at, ends_at
      from public.slots
      where producer_id = p_producer_id
        and active = true
        and starts_at >= p_slots_range_start
        and starts_at < p_slots_range_end
    ),
    week_pickups as (
      select date_retrait, slot_id, statut
      from public.orders
      where producer_id = p_producer_id
        and date_retrait >= p_week_start_iso
        and date_retrait < p_week_end_iso
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
    'low_stock_products', coalesce((select jsonb_agg(to_jsonb(ls)) from low_stock ls), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function public.get_producer_dashboard(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, date, date, date
) from public, anon, authenticated;

grant execute on function public.get_producer_dashboard(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, uuid, date, date, date
) to service_role;

comment on function public.get_producer_dashboard is
  'F-045 (audit pré-launch 2026-05-11) — RPC consolidée dashboard producer. '
  'Remplace 11 queries Promise.all() inline page.tsx → 1 RPC SECDEF, 1 conn slot. '
  'Contrat : service_role-only (l''app vérifie l''ownership en amont via fetchProducerForUser).';
