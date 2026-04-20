-- =============================================================================
-- TerrOir — optimisation de search_producers()
-- =============================================================================
-- Remplace le JOIN + GROUP BY sur public.reviews par une lecture directe
-- des colonnes `note_moyenne` et `nb_avis` dénormalisées sur producers.
-- Ces colonnes sont maintenues à jour par /api/admin/reviews/[id]/moderate.
-- =============================================================================

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
    )) as distance_km,
    p.note_moyenne::numeric as note_moyenne,
    p.nb_avis               as nb_avis
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
    and (6371 * acos(
      greatest(-1, least(1,
        cos(radians(p_lat)) * cos(radians(p.latitude))
        * cos(radians(p.longitude) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(p.latitude))
      ))
    )) <= p_radius_km
  order by distance_km;
$$;

-- Le grant reste valide depuis la première déclaration, mais on le rejoue
-- pour robustesse (create or replace ne réinitialise pas les privilèges).
grant execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) to anon, authenticated;
