-- =============================================================================
-- TerrOir — Chantier T-205 : filtres recherche enums score carbone
-- =============================================================================
-- Étend la RPC `search_producers` avec 3 nouveaux paramètres optionnels
-- correspondant aux 3 enums score-carbone (T-200) :
--   - p_mode_elevage    text[] — multi-select OR
--   - p_alimentation    text[] — multi-select OR
--   - p_densite_animale text[] — multi-select OR
--
-- Sémantique multi-select : un producteur match si son enum ∈ p_<enum>.
-- Plusieurs filtres combinés sur des enums différents = AND (ex.
-- mode_elevage IN (plein_air) AND alimentation IN (pature_dominante)).
--
-- Validation Zod côté caller (route handler) : on whitelist les valeurs
-- d'enums via les *_VALUES. Le SQL n'a pas de CHECK — texte libre, mais
-- une valeur inconnue ne match aucun row donc no-op (defense in depth UI).
--
-- Convention idempotence T-297 : DROP FUNCTION + CREATE (signature change
-- 5 args → 8 args). REVOKE PUBLIC + GRANT anon/authenticated/service_role
-- explicite (ACL hardenisée cohérente avec migration 20260505300600).
-- =============================================================================

drop function if exists public.search_producers(
  double precision, double precision, double precision, text[], text[]
);
drop function if exists public.search_producers(
  double precision, double precision, double precision, text[], text[],
  text[], text[], text[]
);

create function public.search_producers(
  p_lat              double precision,
  p_lng              double precision,
  p_radius_km        double precision,
  p_especes          text[] default null,
  p_labels           text[] default null,
  p_mode_elevage     text[] default null,
  p_alimentation     text[] default null,
  p_densite_animale  text[] default null
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
      and (
        p_mode_elevage is null
        or array_length(p_mode_elevage, 1) is null
        or p.mode_elevage = any(p_mode_elevage)
      )
      and (
        p_alimentation is null
        or array_length(p_alimentation, 1) is null
        or p.alimentation = any(p_alimentation)
      )
      and (
        p_densite_animale is null
        or array_length(p_densite_animale, 1) is null
        or p.densite_animale = any(p_densite_animale)
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

revoke execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[],
  text[], text[], text[]
) from public;

grant execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[],
  text[], text[], text[]
) to anon, authenticated, service_role;
