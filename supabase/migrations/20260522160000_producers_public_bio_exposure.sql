-- Chantier 3 Phase 4 — exposition publique du flag bio.
--
-- Le badge + le filtre bio côté consommateur ne doivent s'afficher QUE pour les
-- producteurs réellement certifiés ET validés par l'admin :
--     bio = true AND bio_validated_at IS NOT NULL
-- (cf. décision 0.1bis : la validation du certificat Agence Bio est un acte
-- admin à valeur juridique ; la simple déclaration producteur ne suffit pas à
-- afficher l'allégation « Agriculture Biologique » publiquement).
--
-- Forward-only, idempotent :
--   - producers_public : CREATE OR REPLACE VIEW + colonne `bio` gated ajoutée
--     en fin de liste (autorisé par Postgres ; grants préservés).
--   - search_producers : changement de signature (ajout p_bio + colonne bio)
--     ⇒ DROP + CREATE + re-grant anon/authenticated/service_role.

-- ============================================================================
-- 1. Vue publique : flag bio gated.
-- ============================================================================
create or replace view public.producers_public as
  select
    id,
    slug,
    nom_exploitation,
    commune,
    code_postal,
    adresse,
    case when latitude is null then null::double precision
         else round(latitude::numeric, 2)::double precision end as latitude,
    case when longitude is null then null::double precision
         else round(longitude::numeric, 2)::double precision end as longitude,
    description,
    histoire,
    photo_principale,
    photos,
    annee_creation,
    generations,
    especes,
    labels,
    badge_stock_score,
    badge_confirmation_score,
    badge_annulation_score,
    note_moyenne,
    nb_avis,
    user_id,
    (bio and bio_validated_at is not null) as bio
  from public.producers p
  where statut = 'public' and deleted_at is null;

-- ============================================================================
-- 2. RPC search_producers : ajout du filtre + colonne bio (gated).
-- ============================================================================
drop function if exists public.search_producers(double precision, double precision, double precision, text[], text[]);
create function public.search_producers(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision,
  p_especes text[] default null::text[],
  p_labels text[] default null::text[],
  p_bio boolean default false
)
returns table(
  id uuid, slug text, nom_exploitation text, commune text, code_postal text,
  latitude double precision, longitude double precision, photo_principale text,
  especes text[], labels text[], badge_stock_score double precision,
  badge_confirmation_score double precision, badge_annulation_score double precision,
  distance_km double precision, note_moyenne numeric, nb_avis integer,
  product_count integer, bio boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with filtered as (
    select p.*
    from public.producers p
    where p.statut = 'public'
      and p.latitude is not null
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
        not p_bio
        or (p.bio and p.bio_validated_at is not null)
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
    round(wd.latitude::numeric, 2)::double precision  as latitude,
    round(wd.longitude::numeric, 2)::double precision as longitude,
    wd.photo_principale, wd.especes, wd.labels,
    wd.badge_stock_score, wd.badge_confirmation_score, wd.badge_annulation_score,
    wd.distance_km,
    wd.note_moyenne::numeric as note_moyenne,
    wd.nb_avis               as nb_avis,
    (
      select count(*)::int
      from public.products pr
      where pr.producer_id = wd.id
        and pr.active = true
    ) as product_count,
    (wd.bio and wd.bio_validated_at is not null) as bio
  from with_distance wd
  where wd.distance_km <= p_radius_km
  order by wd.distance_km;
$$;

grant execute on function public.search_producers(double precision, double precision, double precision, text[], text[], boolean) to anon, authenticated, service_role;
