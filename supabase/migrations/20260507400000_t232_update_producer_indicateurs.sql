-- =============================================================================
-- TerrOir — Chantier T-232 : RPC update_producer_indicateurs (rectification post-onboarding)
-- =============================================================================
-- L'onboarding pose les 3 enums score-carbone (mode_elevage, alimentation,
-- densite_animale) via la RPC update_producer_onboarding (T-241 + T-243), qui
-- bascule statut='pending' pour validation admin. Une fois le producer en
-- statut='active' ou 'public', il doit pouvoir rectifier ses indicateurs sans
-- repasser en pending (ce serait régresser le statut public). T-232 introduit
-- donc une RPC dédiée à la rectification post-onboarding qui :
--   1. ne modifie QUE les 3 enums + les 4 colonnes declaration_indicateurs_* ;
--   2. préserve statut, slug, badges, etc. ;
--   3. ré-applique strictement la sémantique DGCCRF de re-dating snapshot
--      (T-241 + T-243) — miroir SQL/JS aligné avec
--      lib/producers/declaration-veracite.ts → shouldPersistDeclarationVeracite.
--
-- Sémantique de re-persistance (identique T-241) :
--   - p_declaration_cochee = TRUE (Zod amont aurait bloqué sinon) ;
--   - au moins un enum effectif post-COALESCE est non NULL ;
--   - snapshot précédent NULL OU diffère sur au moins un des 3 axes.
--
-- Cas « tous enums passent à NULL » : on ne touche pas aux colonnes
-- declaration_indicateurs_* (préserve le timestamp historique probatoire).
--
-- Cas « lat/lng » : T-232 spec inclut "re-géocodage adresse". On NE le gère
-- PAS dans cette RPC — le re-géocodage du couple (code_postal, commune) reste
-- côté admin (T-218-bis bloque self-update lat/lng pour les owner). La RPC
-- update_producer_indicateurs ici ne touche qu'aux 3 enums score-carbone +
-- colonnes DGCCRF associées. Si Romain souhaite plus tard une RPC séparée
-- pour rectifier l'adresse + déclencher re-géocodage admin, ce sera un
-- chantier dédié (déjà tracé en backlog T-227).
--
-- ACL : SECURITY DEFINER + REVOKE PUBLIC/anon/authenticated + GRANT
-- service_role uniquement. Cohérent T-241 + T-295. Caller : nouvelle server
-- action lib/producers/update-indicateurs.ts via createSupabaseAdminClient.
--
-- Idempotence (T-297) :
--   - CREATE OR REPLACE FUNCTION
--   - REVOKE/GRANT idempotents par construction
-- =============================================================================

create or replace function public.update_producer_indicateurs(
  p_user_id uuid,
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
  -- SELECT FOR UPDATE : lock row-level. Ferme la fenêtre double-clic / retry
  -- sur un save indicateurs simultané.
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

  -- COALESCE : un enum NULL côté formulaire ne doit PAS écraser la colonne.
  v_effective_mode := coalesce(p_mode_elevage, v_current_mode);
  v_effective_alim := coalesce(p_alimentation, v_current_alim);
  v_effective_dens := coalesce(p_densite_animale, v_current_dens);

  -- ===========================================================================
  -- MIROIR JS — toute modif ici exige une modif identique dans
  --   lib/producers/declaration-veracite.ts → shouldPersistDeclarationVeracite.
  -- Bloc strictement identique à update_producer_onboarding (T-241 + T-243).
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
    end
  where user_id = p_user_id;
end;
$$;

comment on function public.update_producer_indicateurs is
  'T-232 — UPDATE atomique des 3 enums score-carbone + colonnes '
  'declaration_indicateurs_* après onboarding. Préserve statut/slug/badges. '
  'Re-dating DGCCRF identique update_producer_onboarding (T-241 + T-243).';

revoke execute on function public.update_producer_indicateurs(
  uuid, text, text, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.update_producer_indicateurs(
  uuid, text, text, text, boolean, text, text
) to service_role;
