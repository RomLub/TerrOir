-- =============================================================================
-- TerrOir — Patch défense en profondeur T-241 (audit Migrations T241-CRIT-1)
-- =============================================================================
-- Date apply : 2026-05-05
-- Tracker version_id : 20260505151248 (apply via MCP apply_migration —
--                       le filename utilise le préfixe sémantique 400000 pour
--                       s'intercaler après le chantier Perf 300xxx, convention
--                       projet déjà adoptée — cf. 20260505300600 etc.).
-- Référence : docs/audits/audit-migrations-2026-05-05.md (T241-CRIT-1)
-- Récap     : docs/fixes/fix-migrations-2026-05-05.md
--
-- Ajout d'une garde auth.uid() = p_user_id en complément de l'ACL
-- service_role only existante (Option B retenue 2026-05-05).
--
-- Caller actuel : complete-onboarding.ts via createSupabaseAdminClient()
-- (service_role) → bypass légitime via le claim JWT role='service_role'.
-- Toute future ouverture du grant à `authenticated` (page édition T-289 / T-294)
-- sera automatiquement protégée par la garde auth.uid() = p_user_id sans
-- migration additionnelle.
--
-- Pattern aligné conceptuellement sur delete_user_account
-- (20260422200000_rgpd_account_deletion.sql:81-84) — adapté pour préserver
-- le call path service_role spécifique à T-241.
--
-- ⚠️ CREATE OR REPLACE (pas DROP+CREATE) : préservation de l'ACL service_role
-- only acquise par la migration 20260504100000. Leçon Lot 8 Perf : un DROP
-- réinitialiserait les grants à PUBLIC par défaut.
--
-- Apply via MCP apply_migration. Reconstitué pour cohérence repo↔prod
-- (pattern documenté chantiers RLS+Auth+Perf).
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
set search_path = public, pg_temp
as $$
declare
  v_jwt_role         text;
  v_current_mode     text;
  v_current_alim     text;
  v_current_dens     text;
  v_current_snapshot jsonb;
  v_effective_mode   text;
  v_effective_alim   text;
  v_effective_dens   text;
  v_persist          boolean;
begin
  -- =========================================================================
  -- DÉFENSE EN PROFONDEUR (audit T241-CRIT-1, Option B 2026-05-05)
  -- =========================================================================
  -- Lecture du claim JWT 'role'. Robuste à deux formats :
  --   - PostgREST historique : current_setting('request.jwt.claim.role')
  --   - PostgREST récent     : current_setting('request.jwt.claims')::jsonb->>'role'
  -- nullif(..., '') pour éviter l'erreur de cast empty-string → jsonb si
  -- aucun JWT n'est présent (cas anon / appel direct postgres).
  -- is distinct from : NULL ne bypass pas (anon / no-JWT entrent dans la garde).
  -- =========================================================================
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );

  if v_jwt_role is distinct from 'service_role' then
    if auth.uid() is null or auth.uid() is distinct from p_user_id then
      raise exception 'Not authorized to update this producer onboarding'
        using errcode = '42501';
    end if;
  end if;

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
  -- formulaire ne soumet rien pour cette colonne.
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
    statut = 'pending'
  where user_id = p_user_id;
end;
$$;

comment on function public.update_producer_onboarding is
  'T-241 — UPDATE atomique fiche producteur (onboarding) avec décision côté SQL '
  'de re-persistance des declaration_indicateurs_* (case sur l''honneur DGCCRF). '
  'Voir lib/producers/declaration-veracite.ts pour la sémantique versionnée du '
  'wording certifié. Garde défense en profondeur ajoutée 2026-05-05 (Option B '
  'audit T241-CRIT-1) : bypass service_role + auth.uid() match sinon.';
