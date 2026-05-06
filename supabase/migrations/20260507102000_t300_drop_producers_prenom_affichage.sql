-- =============================================================================
-- TerrOir — T-300 : DROP COLUMN producers.prenom_affichage (Phase 3 finale)
-- =============================================================================
-- Vision funnel producteur Phase 3 finale. Decision produit : reutiliser
-- users.prenom directement pour signer le post-it "Conseil de [prenom]"
-- au lieu d'un champ dedie producers.prenom_affichage. Sous-chantier "reads"
-- deja livre (helper getProducerDisplayName lit users.prenom direct).
--
-- Cette migration finalise les "writes" :
--   1. Drop la 16-args update_producer_onboarding (T-243), recree en 15-args
--      sans p_prenom_affichage. Caller `complete-onboarding.ts` mis a jour
--      dans le meme commit pour ne plus passer le parametre.
--   2. Recree le trigger producers_block_owner_admin_columns sans le check
--      sur prenom_affichage (T-218 + T-218-bis 25 colonnes -> 24 colonnes).
--   3. DROP CONSTRAINT producers_prenom_affichage_len_check (CHECK pose par
--      migration 20260423100000).
--   4. DROP COLUMN producers.prenom_affichage.
--
-- Note timestamp : applique 2026-05-07 via mcp__supabase__apply_migration
-- (timestamp serveur). Trace locale postee dans le slot Teammate A
-- 20260507102000 pour ordre logique chantier 2026-05-07. Aucun impact
-- technique (la migration est deja enregistree en prod).
--
-- Convention idempotence T-297 :
--   - DROP FUNCTION IF EXISTS avec signature precise.
--   - CREATE OR REPLACE FUNCTION pour la nouvelle 15-args et le trigger.
--   - ALTER TABLE DROP CONSTRAINT IF EXISTS / DROP COLUMN IF EXISTS.
--
-- Compatibilite : les rows existantes ont prenom_affichage NOT NULL
-- (migration 20260423120000), backfille depuis users.prenom (migration
-- 20260423110000). Le DROP COLUMN supprime la donnee historique mais
-- users.prenom existe en parallele. Pas de perte d'information visible.
--
-- # Smoke tests post-apply (db-state 2026-05-07) — TOUS VERTS
-- (a) RPC 15-args : pg_proc pronargs=15, p_prenom_affichage absent.
-- (b) Colonne droppee : information_schema.columns vide pour
--     prenom_affichage.
-- (c) Trigger ne reference plus new.prenom_affichage : pg_get_functiondef
--     ILIKE 'new.prenom_affichage' = false.
-- (d) Trigger toujours actif sur UPDATE producers.
-- (e) 10 producers en base, no breakage.
-- =============================================================================

-- 1) Drop la 16-args legacy (T-243).
drop function if exists public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text
);

-- 2) Recree la RPC en 15-args sans p_prenom_affichage. Logique inchangee
-- vs T-243 hormis le retrait de l'ecriture prenom_affichage.
create or replace function public.update_producer_onboarding(
  p_user_id uuid,
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

comment on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text
) is
  'T-241 + T-243 + T-300 — UPDATE atomique fiche producteur (onboarding) avec '
  'décision côté SQL de re-persistance des declaration_indicateurs_*. T-300 '
  'a retire p_prenom_affichage (colonne droppee — display name lu via '
  'users.prenom).';

-- ACL : REVOKE PUBLIC + GRANT service_role only.
revoke execute on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text
) to service_role;

-- 3) Recree le trigger sans le check prenom_affichage.
create or replace function public.producers_block_owner_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;

  if (select public.is_admin()) then
    return new;
  end if;

  if new.statut is distinct from old.statut then
    raise exception 'producers.statut is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.abonnement_niveau is distinct from old.abonnement_niveau then
    raise exception 'producers.abonnement_niveau is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.abonnement_expire_at is distinct from old.abonnement_expire_at then
    raise exception 'producers.abonnement_expire_at is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.stripe_account_id is distinct from old.stripe_account_id then
    raise exception 'producers.stripe_account_id is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.stripe_charges_enabled is distinct from old.stripe_charges_enabled then
    raise exception 'producers.stripe_charges_enabled is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled then
    raise exception 'producers.stripe_payouts_enabled is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.stripe_details_submitted is distinct from old.stripe_details_submitted then
    raise exception 'producers.stripe_details_submitted is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.stripe_cleanup_pending is distinct from old.stripe_cleanup_pending then
    raise exception 'producers.stripe_cleanup_pending is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.badge_stock_score is distinct from old.badge_stock_score then
    raise exception 'producers.badge_stock_score is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.badge_confirmation_score is distinct from old.badge_confirmation_score then
    raise exception 'producers.badge_confirmation_score is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.badge_annulation_score is distinct from old.badge_annulation_score then
    raise exception 'producers.badge_annulation_score is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.declaration_indicateurs_veracite_at is distinct from old.declaration_indicateurs_veracite_at then
    raise exception 'producers.declaration_indicateurs_veracite_at is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.declaration_indicateurs_snapshot is distinct from old.declaration_indicateurs_snapshot then
    raise exception 'producers.declaration_indicateurs_snapshot is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.declaration_indicateurs_wording_version is distinct from old.declaration_indicateurs_wording_version then
    raise exception 'producers.declaration_indicateurs_wording_version is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.note_moyenne is distinct from old.note_moyenne then
    raise exception 'producers.note_moyenne is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.nb_avis is distinct from old.nb_avis then
    raise exception 'producers.nb_avis is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'producers.user_id is immutable (T-218)' using errcode = '42501';
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'producers.slug is admin-only (T-218)' using errcode = '42501';
  end if;

  -- T-300 : prenom_affichage dropped (column removed). Check retire.

  if new.forme_juridique is distinct from old.forme_juridique then
    raise exception 'producers.forme_juridique is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.type_production is distinct from old.type_production then
    raise exception 'producers.type_production is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.type_production_precision is distinct from old.type_production_precision then
    raise exception 'producers.type_production_precision is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'producers.deleted_at is admin-only (T-218)' using errcode = '42501';
  end if;

  if new.latitude is distinct from old.latitude then
    raise exception 'producers.latitude is admin-only (T-218-bis)' using errcode = '42501';
  end if;

  if new.longitude is distinct from old.longitude then
    raise exception 'producers.longitude is admin-only (T-218-bis)' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 4) DROP CONSTRAINT length check + DROP COLUMN.
alter table public.producers
  drop constraint if exists producers_prenom_affichage_len_check;

alter table public.producers
  drop column if exists prenom_affichage;
