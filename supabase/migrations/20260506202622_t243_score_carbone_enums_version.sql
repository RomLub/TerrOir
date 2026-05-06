-- =============================================================================
-- TerrOir — Chantier T-243 : versioning enums score carbone (DGCCRF)
-- =============================================================================
-- Ajoute une 4ᵉ colonne sur public.producers pour stamper la VERSION des
-- valeurs d'enums score-carbone (`mode_elevage`, `alimentation`,
-- `densite_animale`) au moment de la déclaration sur l'honneur du
-- producteur.
--
-- Cette colonne est complémentaire de `declaration_indicateurs_wording_version`
-- (T-241/T-292) qui stamp la version du TEXTE certifié vu par le producteur.
-- Ici on stamp la version des VALEURS et de leur définition métier — pour
-- qu'un audit DGCCRF rétrospectif puisse répondre :
--   « Quelles valeurs étaient possibles au moment de cette déclaration ?
--     Et qu'est-ce que `pature_dominante` voulait dire à ce moment-là ? »
--
-- La sémantique version → snapshot des enums est archivée en code source
-- dans `lib/producers/score-carbone-enums-versions.ts` § map
-- `SCORE_CARBONE_ENUMS_WORDINGS`, volontairement immuable au fil des bumps
-- (ne jamais modifier une entrée existante — pattern T-282).
--
-- Pourquoi 2 colonnes (wording + enums) au lieu d'une seule version
-- composite ? Parce que les deux peuvent évoluer indépendamment :
--   - bump wording sans bump enums = reformulation phrase certifiée.
--   - bump enums sans bump wording = ajout valeur enum / révision label
--     ou hint d'une valeur existante.
-- Un champ unique forcerait à bumper les deux à chaque modif d'un seul
-- côté (= perte de granularité probatoire + bruit dans la trace).
--
-- Convention idempotence (T-297) :
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS
--   - DROP CONSTRAINT IF EXISTS avant ADD CONSTRAINT
--   - CREATE OR REPLACE FUNCTION
-- =============================================================================

-- 1) Colonne nullable (cohérent avec les 3 autres declaration_indicateurs_*).
alter table public.producers
  add column if not exists declaration_indicateurs_enums_version text;

-- 2) CHECK constraint whitelist version. À étendre quand bump v1.1+ via
-- migration ALTER TABLE DROP/ADD CONSTRAINT (cf. T-292 pour le wording).
alter table public.producers
  drop constraint if exists declaration_indicateurs_enums_version_check;

alter table public.producers
  add constraint declaration_indicateurs_enums_version_check
  check (
    declaration_indicateurs_enums_version is null
    or declaration_indicateurs_enums_version = any (array['v1.0'::text])
  );

-- 3) Ajout du paramètre p_enums_version à la RPC update_producer_onboarding.
-- On crée une NOUVELLE signature 16 args en parallèle de l'ancienne 15 args
-- (T-241). Le caller server action `complete-onboarding.ts` est mis à jour
-- pour appeler la 16 args en passant SCORE_CARBONE_ENUMS_VERSION.
--
-- L'ancienne signature 15 args reste en place TEMPORAIREMENT pour éviter
-- une fenêtre incompatibilité migration apply ↔ déploiement code (sinon
-- tout onboarding entrant échouerait pendant le delta). À nettoyer dans
-- une migration suivante post-déploiement (cf. backlog T-243-bis :
-- DROP FUNCTION public.update_producer_onboarding(... 15 args ...)).
--
-- Sémantique de stampage : on (re)écrit declaration_indicateurs_enums_version
-- exactement aux mêmes conditions que les 3 colonnes T-241 — c'est-à-dire
-- avec le même flag v_persist (cohérence atomique avec le snapshot et le
-- wording_version). Si v_persist=false, on ne touche pas la colonne (cas
-- "tous enums vidés" → préserver la trace historique).
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
  p_wording_version text,
  p_enums_version text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
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

  v_effective_mode := coalesce(p_mode_elevage, v_current_mode);
  v_effective_alim := coalesce(p_alimentation, v_current_alim);
  v_effective_dens := coalesce(p_densite_animale, v_current_dens);

  -- ===========================================================================
  -- MIROIR JS — toute modif ici exige une modif identique dans
  --   lib/producers/declaration-veracite.ts → shouldPersistDeclarationVeracite.
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
    declaration_indicateurs_enums_version = case
      when v_persist then p_enums_version
      else declaration_indicateurs_enums_version
    end,
    statut = 'pending'
  where user_id = p_user_id;
end;
$$;

comment on function public.update_producer_onboarding is
  'T-241 + T-243 — UPDATE atomique fiche producteur (onboarding) avec décision '
  'côté SQL de re-persistance des declaration_indicateurs_* (case sur l''honneur '
  'DGCCRF + version wording certifié + version enums score-carbone). Voir '
  'lib/producers/declaration-veracite.ts (wording) et '
  'lib/producers/score-carbone-enums-versions.ts (enums) pour la sémantique '
  'versionnée immuable.';

-- 4) ACL pour la NOUVELLE signature 16 args — REVOKE PUBLIC + GRANT
-- service_role only (cohérent T-241/T-295). L'ancienne signature 15 args
-- conserve son ACL inchangée (revoke/grant ciblent une signature précise).
revoke execute on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text
) to service_role;
