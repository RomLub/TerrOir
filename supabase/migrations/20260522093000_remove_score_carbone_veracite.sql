-- Chantier 3 (Leads) — Phase 1 / sous-chantier 0.1bis : suppression complète
-- du système score-carbone (mode_elevage / alimentation / densite_animale) et
-- de la déclaration de véracité DGCCRF associée. Remplacé par le flag bio
-- (20260522091000). Forward-only. Pré-launch : perte des valeurs historiques
-- assumée (cf. ADR 0003). Décision Romain 2026-05-22.
--
-- Ordre impératif : on retire toutes les dépendances (contraintes, vue, RPC,
-- trigger) AVANT de droper les 7 colonnes, sinon le DROP COLUMN échoue ou
-- laisse des fonctions qui référencent des colonnes inexistantes (erreur
-- runtime au prochain appel).

-- ============================================================================
-- 1. CHECK constraints sur les colonnes supprimées
-- ============================================================================
alter table public.producers drop constraint if exists producers_mode_elevage_check;
alter table public.producers drop constraint if exists producers_alimentation_check;
alter table public.producers drop constraint if exists producers_densite_animale_check;
alter table public.producers drop constraint if exists declaration_indicateurs_wording_version_check;
alter table public.producers drop constraint if exists declaration_indicateurs_enums_version_check;

-- ============================================================================
-- 2. Vue publique producers_public : retrait des 3 indicateurs.
--    DROP+CREATE obligatoire (CREATE OR REPLACE VIEW interdit le retrait de
--    colonnes). Aucune dépendance (vérifié pg_depend). Grants Supabase par
--    défaut re-posés.
-- ============================================================================
drop view if exists public.producers_public;
create view public.producers_public as
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
    user_id
  from public.producers p
  where statut = 'public' and deleted_at is null;

grant select on public.producers_public to anon, authenticated, service_role;

-- ============================================================================
-- 3. RPC update_producer_indicateurs : supprimée (plus d'objet).
-- ============================================================================
drop function if exists public.update_producer_indicateurs(uuid, text, text, text, boolean, text, text);

-- ============================================================================
-- 4. RPC search_producers : retrait des 3 filtres facets indicateurs.
--    Changement de signature ⇒ DROP + CREATE. Grants anon/authenticated/
--    service_role re-posés (cf. CLAUDE.md : helpers SECDEF consommés par les
--    surfaces publiques exigent EXECUTE anon + authenticated).
-- ============================================================================
drop function if exists public.search_producers(double precision, double precision, double precision, text[], text[], text[], text[], text[]);
create function public.search_producers(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision,
  p_especes text[] default null::text[],
  p_labels text[] default null::text[]
)
returns table(
  id uuid, slug text, nom_exploitation text, commune text, code_postal text,
  latitude double precision, longitude double precision, photo_principale text,
  especes text[], labels text[], badge_stock_score double precision,
  badge_confirmation_score double precision, badge_annulation_score double precision,
  distance_km double precision, note_moyenne numeric, nb_avis integer,
  product_count integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with filtered as (
    select p.*
    from public.producers p
    where p.statut = 'public'
      and p.latitude is not null
      and p.longitude is not null
      and (
        p_especes is null
        or array_length(p_especes, 1) is null
        or p.especes && p_especes
      )
      and (
        p_labels is null
        or array_length(p_labels, 1) is null
        or p.labels && p_labels
      )
  ),
  with_distance as (
    select
      f.*,
      (6371 * acos(
        greatest(-1, least(1,
          cos(radians(p_lat)) * cos(radians(f.latitude))
          * cos(radians(f.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(f.latitude))
        ))
      )) as distance_km
    from filtered f
  )
  select
    wd.id, wd.slug, wd.nom_exploitation, wd.commune, wd.code_postal,
    round(wd.latitude::numeric, 2)::double precision  as latitude,
    round(wd.longitude::numeric, 2)::double precision as longitude,
    wd.photo_principale, wd.especes, wd.labels,
    wd.badge_stock_score, wd.badge_confirmation_score, wd.badge_annulation_score,
    wd.distance_km,
    wd.note_moyenne::numeric as note_moyenne,
    wd.nb_avis               as nb_avis,
    (
      select count(*)::int
      from public.products pr
      where pr.producer_id = wd.id
        and pr.active = true
    ) as product_count
  from with_distance wd
  where wd.distance_km <= p_radius_km
  order by wd.distance_km;
$$;

grant execute on function public.search_producers(double precision, double precision, double precision, text[], text[]) to anon, authenticated, service_role;

-- ============================================================================
-- 5. RPC update_producer_onboarding : retrait des arguments indicateurs +
--    véracité. Changement de signature ⇒ DROP + CREATE. Grant service_role.
-- ============================================================================
drop function if exists public.update_producer_onboarding(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text);
create function public.update_producer_onboarding(
  p_user_id uuid,
  p_nom_exploitation text,
  p_forme_juridique text,
  p_siret text,
  p_adresse text,
  p_code_postal text,
  p_commune text,
  p_type_production text,
  p_type_production_precision text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.producers set
    nom_exploitation = p_nom_exploitation,
    forme_juridique = p_forme_juridique,
    siret = p_siret,
    adresse = p_adresse,
    code_postal = p_code_postal,
    commune = p_commune,
    type_production = p_type_production,
    type_production_precision = p_type_production_precision,
    statut = 'pending'
  where user_id = p_user_id;

  if not found then
    raise exception 'Producer non trouvé pour user_id=%', p_user_id
      using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.update_producer_onboarding(uuid, text, text, text, text, text, text, text, text) to service_role;

-- ============================================================================
-- 6. Trigger producers_block_owner_admin_columns : retrait des 4 checks
--    indicateurs/véracité, ajout de publication_requested_at + bio_validated_at
--    en admin-only. bio + bio_certificate_number restent producer-writable
--    (le producteur déclare lui-même, la validation admin pose bio_validated_at).
-- ============================================================================
create or replace function public.producers_block_owner_admin_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- T-218-bis : privacy lat/lng (set exclusivement par /api/geocode service_role).
  if new.latitude is distinct from old.latitude then
    raise exception 'producers.latitude is admin-only (T-218-bis)' using errcode = '42501';
  end if;

  if new.longitude is distinct from old.longitude then
    raise exception 'producers.longitude is admin-only (T-218-bis)' using errcode = '42501';
  end if;

  -- Chantier 3 (2026-05-22) : demande de publication posée exclusivement par la
  -- RPC request_publication (service_role) après vérif critères. Un producteur
  -- ne peut pas la poser via un UPDATE direct.
  if new.publication_requested_at is distinct from old.publication_requested_at then
    raise exception 'producers.publication_requested_at is admin-only (chantier-3)' using errcode = '42501';
  end if;

  -- Chantier 3 (2026-05-22) : la validation du certificat bio est un acte admin
  -- (protection juridique). Le producteur déclare bio + bio_certificate_number
  -- (producer-writable), mais seul l'admin pose bio_validated_at.
  if new.bio_validated_at is distinct from old.bio_validated_at then
    raise exception 'producers.bio_validated_at is admin-only (chantier-3)' using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ============================================================================
-- 7. Drop des 7 colonnes score-carbone / véracité.
--    Une instruction ALTER TABLE ... DROP COLUMN par colonne : le codegen
--    enums (scripts/codegen-enums.ts) ne reconnaît qu'un seul drop par
--    instruction ALTER TABLE — un drop multi-colonnes laisserait des enums
--    fantômes dans lib/types/generated/enums.ts.
-- ============================================================================
alter table public.producers drop column if exists mode_elevage;
alter table public.producers drop column if exists alimentation;
alter table public.producers drop column if exists densite_animale;
alter table public.producers drop column if exists declaration_indicateurs_veracite_at;
alter table public.producers drop column if exists declaration_indicateurs_snapshot;
alter table public.producers drop column if exists declaration_indicateurs_wording_version;
alter table public.producers drop column if exists declaration_indicateurs_enums_version;
