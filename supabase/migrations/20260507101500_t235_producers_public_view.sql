-- =============================================================================
-- TerrOir — T-235 : vue producers_public (defense-in-depth lat/lng floues)
-- =============================================================================
-- Contexte : la checklist pre-Live mentionne T-235 comme "deja livree par
-- T-218-bis lat/lng admin-only" (protection RLS au niveau DB), mais la vue
-- effective n'existait pas. T-218-bis verrouille les WRITE producteur sur
-- 25 colonnes admin-only (incluant lat/lng), mais ne change pas la
-- visibilite des lat/lng en lecture publique. Le floutage 2 decimales est
-- aujourd'hui applique en JS via roundCoord (lib/producers/coords.ts) sur
-- 3 call sites (fetch-public.ts, /api/producers/search, /compte/commandes/[id]).
--
-- Cette vue ajoute une defense-in-depth Postgres : un consumer qui lit via
-- supabase-js sans passer par les helpers JS canoniques recoit deja des
-- coordonnees floutees au niveau DB. Filet de securite contre une regression
-- ulterieure (nouvelle route oubliant l'arrondi).
--
-- Note timestamp : applique 2026-05-07 via mcp__supabase__apply_migration
-- sous timestamp serveur 20260506222845 (proche de T-243-bis). Trace locale
-- postee dans le slot Teammate A 20260507101500 pour ordre logique chantier.
-- Aucun impact technique (la migration est deja enregistree en prod).
--
-- # Decisions techniques
--
-- 1) SECURITY INVOKER (defaut depuis PG 15 quand non specifie, mais pose
--    explicitement pour traçabilite). RLS de la table sous-jacente passe a
--    travers : un consumer anonyme respecte les policies "statut=public AND
--    deleted_at IS NULL" deja en place. Pas d'escalation.
--
-- 2) Floutage SQL via round(lat::numeric, 2). Math.round JS = banker's
--    rounding qui converge vers .5 → pair, alors que round() Postgres applique
--    un half-away-from-zero. Difference observable uniquement sur les valeurs
--    se terminant exactement par .005 — extremement rare en pratique pour des
--    coordonnees geocodees a 6 decimales. Pas de helper SQL custom : la vue
--    reste simple et inspectable.
--
-- 3) Projection limitee aux colonnes publiques deja exposees dans
--    PUBLIC_COLUMNS de lib/producers/fetch-public.ts. Exclut siret,
--    forme_juridique, type_production, abonnement_*, stripe_*, deleted_at,
--    declaration_indicateurs_* (admin-only).
--
-- 4) GRANT SELECT TO anon, authenticated (les autres roles ont SELECT
--    par heritage Supabase via ALTER DEFAULT PRIVILEGES).
--
-- # Smoke tests post-apply (db-state 2026-05-07) — TOUS VERTS
-- (a) Lecture publique : SELECT count(*) FROM producers_public → 1 row
-- (b) Coords arrondies : 48.3706 → 48.37, -0.0656 → -0.07 (matches roundCoord JS)
-- (c) Bypass non regresse : service_role lit la table source non floutee
--     (raw_count=1, raw_with_coords=1)
--
-- Convention idempotence T-297 : DROP VIEW IF EXISTS avant CREATE VIEW
-- (CREATE OR REPLACE VIEW echoue si la liste de colonnes change, le DROP
-- explicite est plus sur).
-- =============================================================================

drop view if exists public.producers_public;

create view public.producers_public
with (security_invoker = true)
as
select
  p.id,
  p.slug,
  p.nom_exploitation,
  p.commune,
  p.code_postal,
  p.adresse,
  -- Floutage 2 decimales (~1.1 km) — defense-in-depth vs JS roundCoord.
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
  'T-235 — Vue defense-in-depth des producers visibles publiquement avec lat/lng '
  'arrondies a 2 decimales (~1.1 km). SECURITY INVOKER : RLS de public.producers '
  'passe a travers (filtre statut + deleted_at deja applique dans la projection '
  'pour eviter cas race). Le floutage canonique reste lib/producers/coords.ts '
  '(roundCoord) applique cote JS sur les 3 call sites publics — cette vue est '
  'un filet de securite si une nouvelle route oublie le helper.';

grant select on public.producers_public to anon, authenticated;
