-- =============================================================================
-- TerrOir — F-008 : trigger T-218 oublie declaration_indicateurs_enums_version
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-008) : le trigger
-- producers_block_owner_admin_columns posé par T-218 bloque
-- declaration_indicateurs_wording_version mais pas
-- declaration_indicateurs_enums_version (ajoutée par migration
-- 20260506202815_t243_score_carbone_enums_version). Conséquence : un
-- producer authentifié peut PATCH /rest/v1/producers?id=eq.<own> avec
-- {declaration_indicateurs_enums_version: 'v0.99'} et corrompre la
-- valeur probatoire de cette colonne sans passer par la RPC
-- update_producer_onboarding qui est la seule voie légitime
-- (cf. SECURITY DEFINER + service_role).
--
-- Implémentation : CREATE OR REPLACE de la fonction trigger en ajoutant
-- une branche calquée exactement sur la branche _wording_version
-- existante. Aucun autre changement.
-- =============================================================================

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

  if new.declaration_indicateurs_enums_version is distinct from old.declaration_indicateurs_enums_version then
    raise exception 'producers.declaration_indicateurs_enums_version is admin-only (T-218)' using errcode = '42501';
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

  if new.prenom_affichage is distinct from old.prenom_affichage then
    raise exception 'producers.prenom_affichage is admin-only (T-218)' using errcode = '42501';
  end if;

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

  return new;
end;
$$;
