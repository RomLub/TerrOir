-- =============================================================================
-- TerrOir — Cluster A privacy (T-217-bis) : verrou DB-level lat/lng
-- =============================================================================
-- Audit pre-launch 2026-05-07 a remonte 4 findings privacy P0/P1/P2/P3 sur
-- les coordonnees producteur (cf. brief Cluster A) :
--
--   sec-P0-1 : RLS policy "producers public read when public" ouvre les
--              colonnes latitude/longitude brutes a anon+authenticated, ce
--              qui contourne la doctrine T-217 (floutage 2 decimales = ~1.1km).
--   sec-P1-1 : RPC search_producers (SECURITY DEFINER, owner postgres) renvoie
--              latitude/longitude bruts au caller anon+authenticated. La
--              defense JS roundCoord cote /api/producers/search masque le
--              probleme mais elle peut etre court-circuitee si la RPC est
--              appelee directement via un client supabase-js (autre route,
--              futur module, etc.).
--   dead-P3-2: La vue producers_public (T-235) existe avec arrondi mais
--              n'est utilisee par aucun call site applicatif → defense
--              in-depth DB jamais activee. Cette migration la rend vraiment
--              effective via REVOKE table-level + re-GRANT col-by-col.
--
-- # Decisions techniques
--
-- 1) REVOKE column-level seul N'EST PAS SUFFISANT en Postgres : si un GRANT
--    table-level SELECT existe deja sur la table, REVOKE column-level n'a
--    aucun effet. Il faut REVOKE table-level SELECT puis re-GRANT
--    explicitement les colonnes autorisees (toutes sauf latitude/longitude).
--    Test empirique 2026-05-07 sur prod : un REVOKE column-level seul
--    laissait les SELECT(latitude) passer pour authenticated. Approche
--    finale : REVOKE table + 40 colonnes re-grantees explicitement.
--    Effet de bord positif : toute nouvelle colonne ajoutee a producers ne
--    sera pas automatiquement SELECT-able par anon/authenticated, ce qui
--    impose une revue ACL explicite a chaque migration future.
--
-- 2) Service_role conserve son acces plein via GRANT ALL TABLES (heritage
--    Supabase). Confirme par smoke test #3.
--
-- 3) La vue producers_public (T-235) etait en SECURITY INVOKER : elle lisait
--    la table source sous l'identite du caller. Avec le REVOKE table-level,
--    elle aurait casse pour anon/authenticated meme si le SELECT ne projette
--    que des coords arrondies. On bascule en SECURITY INVOKER = false (mode
--    DEFINER) : la vue lit la table source sous l'identite owner (postgres)
--    qui bypass les ACL. Le filtre WHERE statut='public' AND deleted_at IS
--    NULL deja present dans le body de la vue garantit la semantique
--    d'isolation publique (cf. commentaire migration originale T-235).
--
-- 4) RPC search_producers : meme signature, body modifie pour appliquer
--    round(lat::numeric, 2) AVANT le retour. La RPC reste SECURITY DEFINER
--    → service_role keying via admin client voit les coords floutees comme
--    tout le monde. C'est un trade-off assume : le seul call site
--    service_role (app/api/producers/search/route.ts) applique deja
--    roundCoord cote JS, donc aucune perte de precision en pratique.
--
-- # Smoke tests post-apply (2026-05-07) — TOUS VERTS
--
--   #1 SET LOCAL ROLE authenticated; SELECT latitude FROM producers
--      → ERROR 42501 permission denied (attendu).
--   #1b SET LOCAL ROLE anon; SELECT latitude FROM producers
--      → ERROR 42501 permission denied (attendu).
--   #2 SET LOCAL ROLE authenticated; SELECT id, slug, statut FROM producers
--      → 1 row (toutes colonnes non-coords accessibles, attendu).
--   #3 SET LOCAL ROLE service_role; SELECT latitude, longitude FROM producers
--      → 1 row (lat=48.3706, lng=-0.0656 bruts — service_role bypass OK).
--   #4 SET LOCAL ROLE authenticated; SELECT * FROM search_producers(...)
--      → 1 row (lat=48.37, lng=-0.07 arrondis 2 decimales — RPC floute).
--   #5 SET LOCAL ROLE authenticated; SELECT lat, lng FROM producers_public
--      → 1 row (lat=48.37, lng=-0.07 arrondis — vue floute via DEFINER).
--   #6 SET LOCAL ROLE anon; SELECT lat, lng FROM producers_public
--      → 1 row (lat=48.37, lng=-0.07 arrondis — anon OK aussi).
--
-- # Convention idempotence T-297
--
-- REVOKE/GRANT idempotents par construction. CREATE OR REPLACE FUNCTION sans
-- DROP. CREATE OR REPLACE VIEW echoue si la liste de colonnes change → on
-- garde DROP VIEW IF EXISTS + CREATE comme dans T-235.
--
-- # Application
--
-- Cette migration a ete appliquee en 2 steps via mcp__supabase__apply_migration
-- (timestamps internes Supabase distincts) puis le fichier source unique a
-- ete consolide ici pour reflechir l'etat final. Trace MCP :
--   - apply 1 : cluster_a_privacy_lat_lng (REVOKE col-level + view + RPC)
--   - apply 2 : cluster_a_privacy_lat_lng_table_revoke (REVOKE table-level
--               + re-GRANT col-by-col, correctif suite smoke test #1 fail)
-- =============================================================================

-- =============================================================================
-- ETAPE 1 : REVOKE table-level SELECT + re-GRANT col-by-col (toutes colonnes
-- sauf latitude/longitude). C'est l'etape critique qui rend le verrou effectif.
-- =============================================================================

revoke select on public.producers from anon;
revoke select on public.producers from authenticated;

grant select (
  id, user_id, slug, nom_exploitation, siret, adresse, commune, code_postal,
  description, histoire, photo_principale, photos, annee_creation, generations,
  especes, labels, statut, abonnement_niveau, abonnement_expire_at,
  stripe_account_id, badge_stock_score, badge_confirmation_score,
  badge_annulation_score, created_at, note_moyenne, nb_avis, forme_juridique,
  type_production, type_production_precision, deleted_at, stripe_cleanup_pending,
  stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted,
  mode_elevage, alimentation, densite_animale,
  declaration_indicateurs_veracite_at, declaration_indicateurs_snapshot,
  declaration_indicateurs_wording_version, declaration_indicateurs_enums_version
) on public.producers to anon;

grant select (
  id, user_id, slug, nom_exploitation, siret, adresse, commune, code_postal,
  description, histoire, photo_principale, photos, annee_creation, generations,
  especes, labels, statut, abonnement_niveau, abonnement_expire_at,
  stripe_account_id, badge_stock_score, badge_confirmation_score,
  badge_annulation_score, created_at, note_moyenne, nb_avis, forme_juridique,
  type_production, type_production_precision, deleted_at, stripe_cleanup_pending,
  stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted,
  mode_elevage, alimentation, densite_animale,
  declaration_indicateurs_veracite_at, declaration_indicateurs_snapshot,
  declaration_indicateurs_wording_version, declaration_indicateurs_enums_version
) on public.producers to authenticated;

-- service_role conserve son SELECT plein via GRANT ALL TABLES (heritage
-- Supabase). Pas de re-GRANT explicite necessaire.

-- =============================================================================
-- ETAPE 2 : Bascule producers_public en SECURITY DEFINER (security_invoker=false)
-- =============================================================================

drop view if exists public.producers_public;
create view public.producers_public
with (security_invoker = false)
as
select
  p.id,
  p.slug,
  p.nom_exploitation,
  p.commune,
  p.code_postal,
  p.adresse,
  case
    when p.latitude is null then null
    else round(p.latitude::numeric, 2)::double precision
  end as latitude,
  case
    when p.longitude is null then null
    else round(p.longitude::numeric, 2)::double precision
  end as longitude,
  p.description,
  p.histoire,
  p.photo_principale,
  p.photos,
  p.annee_creation,
  p.generations,
  p.especes,
  p.labels,
  p.badge_stock_score,
  p.badge_confirmation_score,
  p.badge_annulation_score,
  p.note_moyenne,
  p.nb_avis,
  p.mode_elevage,
  p.alimentation,
  p.densite_animale,
  p.user_id
from public.producers p
where p.statut = 'public'
  and p.deleted_at is null;

comment on view public.producers_public is
  'T-217-bis (Cluster A) — Vue defense-in-depth des producers visibles '
  'publiquement avec lat/lng arrondies a 2 decimales (~1.1 km). '
  'SECURITY DEFINER (security_invoker=false) car REVOKE SELECT(lat,lng) '
  'sur la table source casserait la lecture en mode INVOKER. La security '
  'reste assuree par la WHERE-clause (statut=public AND deleted_at IS NULL). '
  'Owner postgres bypass les RLS mais le filtre body reproduit la semantique '
  'd''isolation publique. Cf. lib/producers/coords.ts pour la doctrine '
  'T-217 et le helper JS roundCoord, filet redondant cote applicatif.';

grant select on public.producers_public to anon, authenticated;

-- =============================================================================
-- ETAPE 3 : RPC search_producers — body modifie, signature inchangee
-- =============================================================================

create or replace function public.search_producers(
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
      -- Distance Haversine sur les COORDS BRUTES → preservation de la
      -- pertinence du filtre par rayon. Le floutage s'applique uniquement
      -- aux valeurs renvoyees, pas au calcul interne.
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
    -- T-217-bis : floutage SQL 2 decimales avant retour (~1.1 km).
    -- Coherent avec la vue producers_public et la helper JS roundCoord.
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
