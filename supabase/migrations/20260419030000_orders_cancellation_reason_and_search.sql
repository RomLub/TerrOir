-- =============================================================================
-- TerrOir — orders.cancellation_reason + search_producers() RPC
-- =============================================================================

-- 1. Motif d'annulation des commandes ----------------------------------------
alter table public.orders
  add column cancellation_reason text;

create index orders_cancellation_reason_idx
  on public.orders (cancellation_reason)
  where cancellation_reason is not null;

comment on column public.orders.cancellation_reason is
  'Texte libre: ''stock'', ''producer_cancel'', ''timeout'', ''consumer_cancel'', etc.';

-- 2. Recherche géographique de producteurs -----------------------------------
-- Haversine (6371 km = rayon terrestre moyen), filtres optionnels sur
-- espèces et labels. Agrège la note moyenne + le nombre d'avis publiés.
create or replace function public.search_producers(
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
  nb_avis                    int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with producers_in_range as (
    select
      p.id, p.slug, p.nom_exploitation, p.commune, p.code_postal,
      p.latitude, p.longitude, p.photo_principale, p.especes, p.labels,
      p.badge_stock_score, p.badge_confirmation_score, p.badge_annulation_score,
      (6371 * acos(
        greatest(-1, least(1,
          cos(radians(p_lat)) * cos(radians(p.latitude))
          * cos(radians(p.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.latitude))
        ))
      )) as distance_km
    from public.producers p
    where p.statut = 'active'
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
  stats as (
    select
      r.producer_id,
      round(avg(r.note)::numeric, 2) as note_moyenne,
      count(*)::int                  as nb_avis
    from public.reviews r
    where r.statut = 'published'
    group by r.producer_id
  )
  select
    pir.id, pir.slug, pir.nom_exploitation, pir.commune, pir.code_postal,
    pir.latitude, pir.longitude, pir.photo_principale, pir.especes, pir.labels,
    pir.badge_stock_score, pir.badge_confirmation_score, pir.badge_annulation_score,
    pir.distance_km,
    coalesce(s.note_moyenne, 0::numeric) as note_moyenne,
    coalesce(s.nb_avis, 0)               as nb_avis
  from producers_in_range pir
  left join stats s on s.producer_id = pir.id
  where pir.distance_km <= p_radius_km
  order by pir.distance_km;
$$;

-- RPC accessible en anonyme (page de recherche publique)
grant execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) to anon, authenticated;
