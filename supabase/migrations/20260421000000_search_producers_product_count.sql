-- =============================================================================
-- TerrOir — ajout de product_count à search_producers()
-- =============================================================================
-- L'annuaire /producteurs et la carte /carte affichent un compteur
-- "N produits disponibles" par producteur. Sans ce champ dans le RPC,
-- le front tombait systématiquement sur 0. On ajoute un sous-select
-- qui compte les produits actifs du producteur.
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
  nb_avis                    int,
  product_count              int
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
    p.nb_avis               as nb_avis,
    (
      select count(*)::int
      from public.products pr
      where pr.producer_id = p.id
        and pr.actif = true
    ) as product_count
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

grant execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) to anon, authenticated;
