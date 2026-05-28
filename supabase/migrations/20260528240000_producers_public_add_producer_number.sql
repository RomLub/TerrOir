-- =============================================================================
-- TerrOir — Vue producers_public : expose producer_number (ADR-0015)
-- =============================================================================
-- Ajout additif du champ `producer_number` (4 chiffres affichés) à la vue
-- producers_public, pour permettre aux surfaces consumer de composer le
-- `numero_commande` au format PPPP-CCCCC.
--
-- Le numéro producteur est non sensible (équivalent fonctionnel du slug
-- public) ; aucun risque de leak côté anon/authenticated.
--
-- Forward-only, idempotent via `create or replace view` (la colonne est
-- ajoutée en fin, les colonnes existantes conservent leur ordre).
-- =============================================================================

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
    bio,
    producer_number
  from public.producers p
  where statut = 'public' and deleted_at is null;

grant select on public.producers_public to anon, authenticated, service_role;

comment on view public.producers_public is
  'Vue publique des producteurs (statut=public, non supprimés). Coords floutées '
  '2 décimales (~1.1 km) pour privacy. Expose producer_number (ADR-0015) pour '
  'composition du numero_commande côté consumer.';
