-- =============================================================================
-- Audit perf-postgres-2026-05-05 — finding C-4 (étape 1/3) — FIX RÉGRESSION
-- =============================================================================
-- Apply effectué le 2026-05-05 via MCP apply_migration, version_id 20260505134154.
-- Reconstitué pour cohérence repo↔prod.
--
-- Réécriture rapide pour corriger la régression introduite par la migration
-- précédente 20260505300400_perf_search_producers_cte (filtre statut sur
-- 'active' au lieu de 'public'). Source de l'erreur : la migration locale
-- 20260421000000_search_producers_product_count utilise 'active' alors qu'en
-- prod 20260422000000_producer_public_filtering avait switché sur 'public'
-- (divergence repo↔prod historique).
--
-- Cette migration restaure 'public' (cohérent avec annuaire / carte / RPC vente).
-- Tout le reste (CTE pour factoriser haversine) est conservé.
--
-- ⚠️ Cette migration NE FIXE PAS encore la régression ACL `=X/postgres` (PUBLIC
-- EXECUTE) introduite par DROP+CREATE FUNCTION — voir migration suivante
-- 20260505300600_perf_search_producers_revoke_public.
-- =============================================================================

drop function if exists public.search_producers(
  double precision, double precision, double precision, text[], text[]
);

create function public.search_producers(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_km  double precision,
  p_especes    text[] default null,
  p_labels     text[] default null
)
returns table (
  id                         uuid,
  slug                       text,
  nom_exploitation           text,
  commune                    text,
  code_postal                text,
  latitude                   double precision,
  longitude                  double precision,
  photo_principale           text,
  especes                    text[],
  labels                     text[],
  badge_stock_score          double precision,
  badge_confirmation_score   double precision,
  badge_annulation_score     double precision,
  distance_km                double precision,
  note_moyenne               numeric,
  nb_avis                    int,
  product_count              int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with filtered as (
    select p.*
    from public.producers p
    where p.statut = 'public'
      and p.latitude  is not null
      and p.longitude is not null
      and (
        p_especes is null
        or array_length(p_especes, 1) is null
        or p.especes && p_especes
      )
      and (
        p_labels is null
        or array_length(p_labels, 1) is null
        or p.labels && p_labels
      )
  ),
  with_distance as (
    select
      f.*,
      (6371 * acos(
        greatest(-1, least(1,
          cos(radians(p_lat)) * cos(radians(f.latitude))
          * cos(radians(f.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(f.latitude))
        ))
      )) as distance_km
    from filtered f
  )
  select
    wd.id, wd.slug, wd.nom_exploitation, wd.commune, wd.code_postal,
    wd.latitude, wd.longitude, wd.photo_principale, wd.especes, wd.labels,
    wd.badge_stock_score, wd.badge_confirmation_score, wd.badge_annulation_score,
    wd.distance_km,
    wd.note_moyenne::numeric as note_moyenne,
    wd.nb_avis               as nb_avis,
    (
      select count(*)::int
      from public.products pr
      where pr.producer_id = wd.id
        and pr.active = true
    ) as product_count
  from with_distance wd
  where wd.distance_km <= p_radius_km
  order by wd.distance_km;
$$;

grant execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) to anon, authenticated;
