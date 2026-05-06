-- =============================================================================
-- TerrOir — T-218 : trigger BEFORE UPDATE bloque self-update colonnes admin-only
-- =============================================================================
-- Audit RLS producers du 2026-05-06 (cf. docs/security/audit-rls-producers-
-- 2026-05-06.md) : la policy "producers owner update" ne contraint que
-- (auth.uid() = user_id) côté WITH CHECK. Postgres RLS WITH CHECK ne peut pas
-- comparer NEW vs OLD (ce sont des références row, non Δ-aware). Conséquence :
-- un producteur authentifié peut self-update STATUT (passer 'pending'→'public'
-- sans validation admin), ABONNEMENT_NIVEAU/EXPIRE_AT, BADGE_*_SCORE, STRIPE_*,
-- DECLARATION_INDICATEURS_* (probatoire DGCCRF), USER_ID, SLUG, NOTE_MOYENNE,
-- NB_AVIS, etc.
--
-- Tous les writes légitimes sur ces colonnes passent par service_role :
--   - statut          → app/(admin)/gestion-producteurs (browser admin via
--                       is_admin() policy) + lib/producers/promote-to-public.ts
--                       (admin = createSupabaseAdminClient)
--   - abonnement_*    → webhook Stripe (service_role)
--   - stripe_*        → app/api/stripe/connect/onboard + sync-account-flags +
--                       handle-account-deauthorized (service_role)
--   - badge_*_score   → lib/producers/recompute-badges (admin = service_role)
--   - declaration_*   → RPC update_producer_onboarding (SECURITY DEFINER appelée
--                       par complete-onboarding.ts via service_role)
--   - note_moyenne /  → trigger reviews ou recompute service_role
--     nb_avis
--   - user_id / slug  → set à la création initiale, jamais modifiés ensuite
--   - prenom_affichage→ wizard onboarding via complete-onboarding service_role
--   - forme_juridique → idem onboarding
--   - type_production*→ idem onboarding
--   - deleted_at      → RPC delete_user_account service_role
--
-- Donc bloquer ces colonnes pour `authenticated` non-admin n'a aucun effet
-- runtime sur les flows légitimes (audit applicatif fait, cf. doc).
--
-- Implémentation : trigger BEFORE UPDATE qui bypass service_role et is_admin(),
-- sinon RAISE EXCEPTION ERRCODE 42501 (insufficient_privilege) si une colonne
-- admin-only est modifiée.
--
-- Pourquoi un trigger plutôt qu'une policy WITH CHECK :
-- Postgres ne donne pas accès à OLD dans une RLS policy (USING évalue OLD,
-- WITH CHECK évalue NEW, mais ne peut pas les comparer dans la même policy).
-- Le pattern column-level GRANT (REVOKE UPDATE puis GRANT UPDATE (col1, col2,
-- ...)) marcherait mais devrait être maintenu en parallèle avec la liste des
-- colonnes ajoutées au schema (forte dette). Le trigger est explicite et
-- centralisé.
--
-- Idempotence : DROP TRIGGER + CREATE OR REPLACE FUNCTION + CREATE TRIGGER.
--
-- Tests : aucun test vitest direct (DDL pure). Defense-in-depth applicative
-- déjà en place (parametres et ma-page n'exposent pas ces colonnes côté UI).
-- Le trigger est une ceinture de sécurité contre un attaquant qui forge une
-- requête PostgREST manuelle vers /rest/v1/producers?id=eq.<id> avec un body
-- contenant `{statut: 'public'}`.
--
-- Rollback :
--   drop trigger if exists producers_block_owner_admin_columns_trigger on public.producers;
--   drop function if exists public.producers_block_owner_admin_columns();
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

  return new;
end;
$$;

drop trigger if exists producers_block_owner_admin_columns_trigger on public.producers;

create trigger producers_block_owner_admin_columns_trigger
before update on public.producers
for each row
execute function public.producers_block_owner_admin_columns();

-- Note : pas de revoke / grant explicite. La fonction est SECURITY DEFINER mais
-- jamais appelée directement (trigger only). L'ACL EXECUTE PUBLIC par défaut est
-- inerte ici (pas de signature standard exposable via PostgREST pour un trigger).
