-- =============================================================================
-- TerrOir — Chantier T-241 : persistance déclaration sur l'honneur producteur
-- =============================================================================
-- Ajoute 3 colonnes à `public.producers` pour archiver l'engagement déclaratif
-- du producteur sur les 3 enums score-carbone (mode_elevage, alimentation,
-- densite_animale). Avant T-241, la case « Je certifie… » de l'onboarding était
-- validée Zod mais non persistée — pas de trace datée en cas de contrôle DGCCRF.
--
-- declaration_indicateurs_veracite_at      : horodatage de la coche/re-coche.
-- declaration_indicateurs_snapshot         : JSON figé des 3 valeurs déclarées
--                                            au moment de la coche (preuve de
--                                            ce sur quoi le producteur s'est
--                                            engagé, indépendamment des
--                                            modifications ultérieures).
-- declaration_indicateurs_wording_version  : version du libellé certifié
--                                            (cf. lib/producers/declaration-
--                                            veracite.ts — DECLARATION_VERACITE
--                                            _WORDING_VERSION = "v1.0").
--                                            La map version → texte exact est
--                                            archivée en code source pour
--                                            préserver la valeur probatoire au
--                                            fil des bumps.
--
-- Toutes nullable : producteurs existants restent NULL (pas de backfill — la
-- prod n'est pas ouverte). Les nouvelles écritures passent par la RPC
-- update_producer_onboarding ci-dessous (UPDATE atomique avec décision
-- côté SQL — pas de fenêtre lecture/modification non atomique en JS).
-- =============================================================================

alter table public.producers
  add column declaration_indicateurs_veracite_at timestamptz null,
  add column declaration_indicateurs_snapshot jsonb null,
  add column declaration_indicateurs_wording_version text null;

-- =============================================================================
-- RPC update_producer_onboarding — UPDATE atomique de la fiche producteur
-- =============================================================================
-- SCOPE ARCHITECTURAL (à lire avant tout) :
-- Cette RPC gère désormais TOUT l'UPDATE onboarding producteur (les 12 champs
-- business + les 3 enums score-carbone + les 3 colonnes declaration_indicateurs_*),
-- pas uniquement les 3 colonnes T-241. Elle devient le PASSAGE OBLIGÉ pour
-- toute écriture de la fiche producteur depuis la server action
-- complete-onboarding.ts. Conséquence pour les chantiers futurs : un nouveau
-- champ onboarding (ajout d'une colonne business sur producers) → AJOUT d'un
-- paramètre p_xxx + AJOUT dans le UPDATE final ci-dessous, pas un nouvel
-- UPDATE séparé côté JS. Toute dérogation à cette règle ré-ouvre la fenêtre
-- de race fermée par T-241.
--
-- Si une page d'édition producteur arrive plus tard (cf. TODO T-289 / T-294),
-- elle doit appeler cette RPC, pas reconstruire un UPDATE JS — sinon la
-- garantie d'atomicité saute pour l'édition.
--
-- COUVERTURE DE TEST :
-- Le projet n'a pas (encore) d'infra de test d'intégration SQL contre une
-- vraie instance Supabase (uniquement Vitest unit + Playwright E2E qui ne
-- couvre pas les RPC d'écriture). Conséquence : le bloc CASE WHEN ci-dessous
-- est couvert INDIRECTEMENT via le helper miroir
-- lib/producers/declaration-veracite.ts → shouldPersistDeclarationVeracite,
-- exercé par tests/lib/producers/declaration-veracite.test.ts. Risque connu :
-- divergence silencieuse entre le SQL et son miroir JS (jsonb ->> 'k' qui
-- renvoie text vs JSON null, IS DISTINCT FROM sur SQL NULL vs strict
-- inequality sur JS null/undefined). À mitiger par : (a) le commentaire
-- MIROIR au-dessus de chaque côté qui force la modif jumelle ; (b) la mise
-- en place d'un test d'intégration SQL réel — tracé en TODO T-296.
--
-- Utilisée par la server action complete-onboarding (création initiale ET
-- reprise Phase 4 de l'onboarding producteur). Encapsule en UN SEUL UPDATE :
--
--   1. l'écriture des champs business (nom_exploitation, forme_juridique,
--      siret, adresse, code_postal, commune, type_production, etc.) ;
--   2. l'écriture des 3 enums score-carbone via COALESCE — un enum NULL
--      côté formulaire ne doit PAS écraser la colonne (sémantique pré-T-241
--      du complete-onboarding.ts ligne 138-147 — `if (parsed.data.X) ...`) ;
--   3. la décision conditionnelle de re-persister les 3 colonnes
--      declaration_indicateurs_* via CASE WHEN, basée sur la comparaison
--      atomique du snapshot précédemment archivé aux enums effectifs
--      (post-COALESCE) — élimine la race lecture-modification inhérente à
--      un SELECT JS suivi d'un UPDATE.
--
-- Sémantique de re-persistance : on (re)écrit les 3 colonnes
-- declaration_indicateurs_* SI ET SEULEMENT SI :
--   - p_declaration_cochee = TRUE (case cochée — Zod aurait bloqué sinon) ;
--   - au moins un enum effectif post-COALESCE est non NULL (sinon pas de
--     déclaration à archiver) ;
--   - le snapshot précédent est NULL (première coche) OU diffère des enums
--     effectifs sur au moins un des 3 axes (re-coche datée à chaque
--     changement réel d'indicateur).
--
-- Cas « tous enums passent à NULL » (producteur qui vide ses 3 indicateurs) :
-- la condition (any_set) bloque la re-persistance. On NE TOUCHE PAS aux 3
-- colonnes — le timestamp et le snapshot historiques sont préservés. Décision
-- probatoire figée : la case avait bien été cochée à T0 sur des valeurs
-- réelles, l'absence de re-déclaration aujourd'hui n'invalide pas cet
-- engagement passé.
--
-- SECURITY DEFINER : la fonction tourne avec les droits de son owner
-- (postgres) — elle est appelée par la server action via le client admin
-- service_role uniquement. Une éventuelle policy RLS future devra écraser
-- les UPDATE directs sur les 3 colonnes declaration_indicateurs_* (cf. point
-- TODO sécurité comité T-241 — T-287 / T-295) ; cette RPC reste le seul
-- write path légitime.
-- =============================================================================

create or replace function public.update_producer_onboarding(
  p_user_id uuid,
  p_prenom_affichage text,
  p_nom_exploitation text,
  p_forme_juridique text,
  p_siret text,
  p_adresse text,
  p_code_postal text,
  p_commune text,
  p_type_production text,
  p_type_production_precision text,
  p_mode_elevage text,
  p_alimentation text,
  p_densite_animale text,
  p_declaration_cochee boolean,
  p_wording_version text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_mode text;
  v_current_alim text;
  v_current_dens text;
  v_current_snapshot jsonb;
  v_effective_mode text;
  v_effective_alim text;
  v_effective_dens text;
  v_persist boolean;
begin
  -- SELECT FOR UPDATE : lock row-level. Toute transaction concurrente sur
  -- le même producer attendra que la nôtre commit avant de pouvoir lire à
  -- son tour — ferme la fenêtre double-clic / retry sur un onboarding.
  select mode_elevage, alimentation, densite_animale,
         declaration_indicateurs_snapshot
    into v_current_mode, v_current_alim, v_current_dens, v_current_snapshot
    from public.producers
    where user_id = p_user_id
    for update;

  if not found then
    raise exception 'Producer non trouvé pour user_id=%', p_user_id
      using errcode = 'P0002';
  end if;

  -- Sémantique d'écriture des 3 enums : COALESCE = ne pas écraser si le
  -- formulaire ne soumet rien pour cette colonne (cas user qui a saisi
  -- d'autres champs sans toucher aux indicateurs).
  v_effective_mode := coalesce(p_mode_elevage, v_current_mode);
  v_effective_alim := coalesce(p_alimentation, v_current_alim);
  v_effective_dens := coalesce(p_densite_animale, v_current_dens);

  -- ===========================================================================
  -- MIROIR JS — toute modif ici exige une modif identique dans
  --   lib/producers/declaration-veracite.ts → shouldPersistDeclarationVeracite.
  -- C'est CE bloc-ci qui s'exécute en prod (SOURCE DE VÉRITÉ runtime). Le
  -- helper JS sert uniquement de spec exécutable testée par Vitest, à défaut
  -- d'infra de test d'intégration SQL (cf. TODO T-296). Garder les deux
  -- alignés à la lettre : ordre des conditions, opérateurs IS DISTINCT FROM
  -- (qui traite NULL ≠ valeur, contrairement à `<>`), extraction `->>` qui
  -- renvoie text (et NULL si la clé est absente du JSONB).
  -- ===========================================================================
  v_persist := p_declaration_cochee
    and (v_effective_mode is not null
      or v_effective_alim is not null
      or v_effective_dens is not null)
    and (v_current_snapshot is null
      or (v_current_snapshot ->> 'mode_elevage') is distinct from v_effective_mode
      or (v_current_snapshot ->> 'alimentation') is distinct from v_effective_alim
      or (v_current_snapshot ->> 'densite_animale') is distinct from v_effective_dens);

  update public.producers set
    prenom_affichage = p_prenom_affichage,
    nom_exploitation = p_nom_exploitation,
    forme_juridique = p_forme_juridique,
    siret = p_siret,
    adresse = p_adresse,
    code_postal = p_code_postal,
    commune = p_commune,
    type_production = p_type_production,
    type_production_precision = p_type_production_precision,
    mode_elevage = v_effective_mode,
    alimentation = v_effective_alim,
    densite_animale = v_effective_dens,
    declaration_indicateurs_veracite_at = case
      when v_persist then now()
      else declaration_indicateurs_veracite_at
    end,
    declaration_indicateurs_snapshot = case
      when v_persist then jsonb_build_object(
        'mode_elevage', v_effective_mode,
        'alimentation', v_effective_alim,
        'densite_animale', v_effective_dens
      )
      else declaration_indicateurs_snapshot
    end,
    declaration_indicateurs_wording_version = case
      when v_persist then p_wording_version
      else declaration_indicateurs_wording_version
    end,
    statut = 'pending'
  where user_id = p_user_id;
end;
$$;

comment on function public.update_producer_onboarding is
  'T-241 — UPDATE atomique fiche producteur (onboarding) avec décision côté SQL '
  'de re-persistance des declaration_indicateurs_* (case sur l''honneur DGCCRF). '
  'Voir lib/producers/declaration-veracite.ts pour la sémantique versionnée du '
  'wording certifié.';
