-- =============================================================================
-- TerrOir — P1 fix régression trigger producers_block_owner_admin_columns
-- =============================================================================
-- CONTEXTE
-- L'audit régression P1 du 2026-05-12 (chantier feature/p1-regression-sweep-
-- axes-1-5) a détecté DEUX régressions silencieuses introduites par la
-- migration `20260511000000_p0_sweep_f008_t218_enums_version.sql` (commit
-- 5fcf720 du 2026-05-11 00:42). Cette dernière a fait un CREATE OR REPLACE
-- FUNCTION à partir d'une copie de la version T-218 d'origine (2026-05-06)
-- sans tenir compte de DEUX modifications intermédiaires :
--
--   1. T-218-bis (migration `20260506172633_t218_bis_lat_lng_admin_only.sql`)
--      ajoutait les checks `latitude` + `longitude` admin-only (privacy
--      anti-forge coords producteur).
--   2. T-300 (migration `20260507102000_t300_drop_producers_prenom_affichage.sql`)
--      retirait le check `prenom_affichage` après DROP COLUMN de la même
--      colonne.
--
-- Conséquences en prod (vérifiées MCP read-only, fenêtre exposition ~36h) :
--   - Bug 1 (latent) : référence `new.prenom_affichage` dans le trigger →
--     toute UPDATE producers via authenticated owner plante avec 42703
--     `record "new" has no field "prenom_affichage"`. Aucun impact UX
--     (tous les flows passent par RPC SECDEF service_role qui bypass).
--   - Bug 2 (théoriquement exploitable) : checks `latitude`/`longitude`
--     manquants → un producer pourrait forger ses coordonnées GPS via
--     PATCH /rest/v1/producers?id=eq.<own>. Bloqué de fait par bug 1
--     (PL/pgSQL plante au runtime sur new.prenom_affichage AVANT d'évaluer
--     les checks lat/lng).
--
-- Diagnostic dérive data : 8 producers en prod, toutes coords dans bounds
-- Sarthe France métropolitaine, 0 producer créé pendant la fenêtre, audit
-- logs sans event post-régression. Aucune dérive data détectée. Voir
-- conversation /plan-ceo-review session 2026-05-12 pour détails complets.
--
-- IMPLÉMENTATION
-- CREATE OR REPLACE FUNCTION du trigger existant (pattern doctrine T-297
-- idempotence migrations) restaurant l'état canonique post-T-300 + T-218-bis
-- + T-243 + P0_F008 (enums_version) :
--   - retire le check `new.prenom_affichage` (3 lignes)
--   - restaure les checks `new.latitude` + `new.longitude` (8 lignes incl.
--     commentaire T-218-bis canonique)
--   - conserve toutes les autres checks admin-only inchangés (incluant
--     declaration_indicateurs_enums_version ajouté par P0_F008)
--
-- Pas de DROP TRIGGER : le binding pg_trigger →
-- producers_block_owner_admin_columns_trigger reste valide après
-- CREATE OR REPLACE FUNCTION. Idempotent + zéro window de garde-fou inactif.
--
-- Note timestamp : applique 2026-05-12 via mcp__supabase__apply_migration
-- (timestamp serveur). Trace locale postée dans le slot 20260512100000 pour
-- ordre logique chantier 2026-05-12 (cohérent avec la convention T-300
-- L19-22 et T-243).
--
-- # Smoke tests post-apply (à exécuter immédiatement après apply)
-- (a) Trigger ne référence plus new.prenom_affichage :
--     SELECT pg_get_functiondef(...)::text ILIKE '%new.prenom_affichage%' = false
-- (b) Trigger référence new.latitude ET new.longitude :
--     ILIKE '%new.latitude%' = true AND ILIKE '%new.longitude%' = true
-- (c) Trigger toujours actif : SELECT FROM pg_trigger WHERE tgname = 'producers_
--     block_owner_admin_columns_trigger' AND NOT tgisinternal
-- (d) UPDATE producers nom_exploitation via service_role fonctionne sans
--     erreur 42703 (smoke test runtime sur 1 producer test).
--
-- ROLLBACK
-- Re-appliquer la migration `20260511000000` ré-introduit la régression.
-- Pour rollback propre : CREATE OR REPLACE FUNCTION avec contenu identique
-- à la version actuelle (avant ce fix). Mais il n'y a aucune raison
-- légitime de rollback ce fix.
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

  -- (T-300 2026-05-07) prenom_affichage column dropped — check removed.
  -- (P1 fix 2026-05-12) cette zone avait été ré-introduite par migration
  -- 20260511000000_p0_sweep_f008_t218_enums_version par erreur ; corrigée
  -- ici en restaurant l'état post-T-300.

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
  -- (P1 fix 2026-05-12) checks restaurés ici — perdus par migration
  -- 20260511000000_p0_sweep_f008_t218_enums_version qui a écrasé T-218-bis.
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
-- CREATE OR REPLACE FUNCTION. Idempotent + zéro window de garde-fou inactif.
