-- Chantier 3 (Leads) — Phase 1 : demande de publication producteur.
-- Colonne publication_requested_at + RPC SECDEF request_publication qui vérifie
-- les critères de publication côté serveur avant de poser la date.
-- Forward-only, idempotent.

alter table public.producers
  add column if not exists publication_requested_at timestamptz null;

-- ============================================================================
-- RPC request_publication(p_user_id)
--   Appelée par /api/producer/request-publication via le client service_role
--   (le user_id authentifié est extrait côté serveur et passé en argument de
--   confiance — même pattern que update_producer_onboarding).
--   SECDEF + appel service_role ⇒ auth.role()='service_role' ⇒ le trigger
--   producers_block_owner_admin_columns bypasse (publication_requested_at est
--   admin-only, seule cette RPC la pose).
--   Retourne jsonb { ok, missing[] } plutôt qu'une exception pour que la route
--   renvoie un 422 avec la liste exacte des critères manquants.
-- Critères (chantier 3, phase 0.1, validés Romain) :
--   1. ≥ 1 produit actif AVEC ≥ 1 photo
--   2. description ≥ 150 caractères (trim)
--   3. photo_principale présente
--   4. commune + code_postal présents
--   5. ≥ 1 créneau actif et non exclu
--   6. compte de paiement Stripe activé (stripe_charges_enabled = true)
-- ============================================================================
create or replace function public.request_publication(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_producer public.producers%rowtype;
  v_missing text[] := array[]::text[];
  v_has_product_with_photo boolean;
  v_has_open_slot boolean;
begin
  select * into v_producer
  from public.producers
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Producer non trouvé pour user_id=%', p_user_id
      using errcode = 'P0002';
  end if;

  -- Déjà publié : no-op idempotent.
  if v_producer.statut = 'public' then
    return jsonb_build_object('ok', true, 'already_public', true);
  end if;

  -- Statut non éligible : un producteur supprimé ou suspendu ne peut pas
  -- demander la publication (le middleware laisse passer les suspendus vers
  -- l'espace pro, donc on garde le garde-fou ici, défense en profondeur).
  if v_producer.statut in ('deleted', 'suspended') then
    return jsonb_build_object('ok', false, 'blocked', v_producer.statut);
  end if;

  -- Critère 2 : description ≥ 150 caractères.
  if v_producer.description is null or length(btrim(v_producer.description)) < 150 then
    v_missing := array_append(v_missing, 'description');
  end if;

  -- Critère 3 : photo de couverture.
  if v_producer.photo_principale is null or btrim(v_producer.photo_principale) = '' then
    v_missing := array_append(v_missing, 'photo_principale');
  end if;

  -- Critère 4 : commune + code postal.
  if v_producer.commune is null or btrim(v_producer.commune) = ''
     or v_producer.code_postal is null or btrim(v_producer.code_postal) = '' then
    v_missing := array_append(v_missing, 'localisation');
  end if;

  -- Critère 6 : paiement Stripe activé.
  if v_producer.stripe_charges_enabled is not true then
    v_missing := array_append(v_missing, 'stripe');
  end if;

  -- Critère 1 : ≥ 1 produit actif avec photo.
  select exists(
    select 1 from public.products pr
    where pr.producer_id = v_producer.id
      and pr.active = true
      and pr.photos is not null
      and array_length(pr.photos, 1) >= 1
  ) into v_has_product_with_photo;
  if not v_has_product_with_photo then
    v_missing := array_append(v_missing, 'product_with_photo');
  end if;

  -- Critère 5 : ≥ 1 créneau actif et non exclu.
  select exists(
    select 1 from public.slots s
    where s.producer_id = v_producer.id
      and s.active = true
      and s.excluded_at is null
  ) into v_has_open_slot;
  if not v_has_open_slot then
    v_missing := array_append(v_missing, 'open_slot');
  end if;

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'missing', to_jsonb(v_missing));
  end if;

  -- Tous critères OK : pose la date (idempotent — ne réécrit pas si déjà posée).
  update public.producers
  set publication_requested_at = coalesce(publication_requested_at, now())
  where user_id = p_user_id
  returning publication_requested_at into v_producer.publication_requested_at;

  return jsonb_build_object(
    'ok', true,
    'publication_requested_at', v_producer.publication_requested_at
  );
end;
$$;

revoke all on function public.request_publication(uuid) from public;
grant execute on function public.request_publication(uuid) to service_role;
