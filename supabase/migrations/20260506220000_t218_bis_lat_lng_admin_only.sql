-- =============================================================================
-- TerrOir — T-218-bis : ajout latitude + longitude au trigger admin-only T-218
-- =============================================================================
-- Suite de la migration T-218 (20260506165934_t218_producers_owner_update_block_
-- admin_columns.sql). T-218 protégeait 23 colonnes ; T-218-bis ajoute lat/lng
-- pour fermer un risque privacy résiduel.
--
-- CONTEXTE PRIVACY
-- Aujourd'hui, latitude / longitude sont owner-writable côté policy RLS
-- "producers owner update". Un producteur malveillant peut PATCH direct via
-- l'API PostgREST (`/rest/v1/producers?id=eq.<id>` avec body
-- `{"latitude": 99.999, "longitude": -99.999}`) pour fausser la position
-- géographique de sa ferme. Conséquences :
--   - Biaiser le DistanceWidget consumer ("près de chez moi" → fausses cartes)
--   - Apparaître dans une zone qui n'est pas la sienne (concurrence déloyale,
--     manipulation des résultats /producteurs?proche=...)
--   - Casser la cohérence avec le code postal / commune (qui restent
--     owner-writable mais publics — donc plus difficile à fausser sans
--     incohérence visible)
--
-- Les coordonnées doivent être définies UNIQUEMENT par :
--   1. Géocodage de l'adresse à l'onboarding producteur (write service-role
--      via /api/geocode → cache + persist sur producers.lat/lng).
--   2. RPC dédiée admin si correction manuelle nécessaire (déménagement
--      producteur, géocodage initial faux). Pas de RPC à ce jour ; à créer
--      en backlog si le besoin émerge (cf. doc audit-rls-producers
--      section "T-218-bis Point d'attention futur").
--
-- IMPLÉMENTATION
-- CREATE OR REPLACE FUNCTION du trigger existant (pattern doctrine T-297
-- idempotence migrations — pas de DROP + CREATE qui invaliderait
-- temporairement la garde-fou). Trigger lui-même inchangé (le binding
-- pg_trigger → pg_proc reste valide après OR REPLACE).
--
-- Liste protégée passe de 23 à 25 colonnes (+ latitude, + longitude).
--
-- Tests post-apply (cf. rapport TB) : 5 cas (3 blocages auth owner sur
-- latitude / longitude / les deux + 2 bypasses service_role et is_admin()).
--
-- Rollback : ré-appliquer la T-218 initiale (CREATE OR REPLACE FUNCTION
-- avec la liste 23 colonnes) ou DROP FUNCTION + recreate sans lat/lng.
-- =============================================================================

create or replace function public.producers_block_owner_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Bypass pour service_role (webhooks, RPC, scripts admin).
  if (select auth.role()) = 'service_role' then
    return new;
  end if;

  -- Bypass pour admins authenticated (gestion-producteurs page).
  if (select public.is_admin()) then
    return new;
  end if;

  -- Pour authenticated non-admin (= owner via "producers owner update" policy),
  -- bloquer la modification de toute colonne admin-only.

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

  -- T-218-bis : protection privacy lat/lng. Coords doivent être set
  -- exclusivement par /api/geocode (service_role) à l'onboarding ou par
  -- une RPC admin dédiée (backlog si correction manuelle nécessaire).
  if new.latitude is distinct from old.latitude then
    raise exception 'producers.latitude is admin-only (T-218-bis)' using errcode = '42501';
  end if;

  if new.longitude is distinct from old.longitude then
    raise exception 'producers.longitude is admin-only (T-218-bis)' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Note : pas de drop/create trigger. Le binding pg_trigger →
-- producers_block_owner_admin_columns_trigger reste valide après
-- CREATE OR REPLACE FUNCTION. Idempotent + zéro window de garde-fou
-- inactif pendant l'apply.
