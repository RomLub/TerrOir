-- ADR-0011 — Checklist de mise en ligne guidée.
--
-- RPC LECTURE SEULE qui reflète les 6 critères de publication de
-- request_publication (migration 20260522092000) SANS effet de bord, pour
-- afficher au producteur, AVANT toute action, ce qui est fait / ce qui manque.
-- Additive / dormante (nouvelle fonction). `stable` + aucun UPDATE.
--
-- Les critères DOIVENT rester en phase avec request_publication :
--   1. description ≥ 150 caractères
--   2. photo_principale présente
--   3. commune + code_postal présents
--   4. stripe_charges_enabled = true
--   5. ≥ 1 produit actif avec ≥ 1 photo
--   6. ≥ 1 créneau actif non exclu

create or replace function public.get_publication_status(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_producer public.producers%rowtype;
  v_desc boolean;
  v_photo boolean;
  v_loc boolean;
  v_stripe boolean;
  v_product boolean;
  v_slot boolean;
  v_missing text[] := array[]::text[];
begin
  select * into v_producer
  from public.producers
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_desc := v_producer.description is not null
    and length(btrim(v_producer.description)) >= 150;
  v_photo := v_producer.photo_principale is not null
    and btrim(v_producer.photo_principale) <> '';
  v_loc := v_producer.commune is not null and btrim(v_producer.commune) <> ''
    and v_producer.code_postal is not null and btrim(v_producer.code_postal) <> '';
  v_stripe := v_producer.stripe_charges_enabled is true;

  select exists(
    select 1 from public.products pr
    where pr.producer_id = v_producer.id
      and pr.active = true
      and pr.photos is not null
      and array_length(pr.photos, 1) >= 1
  ) into v_product;

  select exists(
    select 1 from public.slots s
    where s.producer_id = v_producer.id
      and s.active = true
      and s.excluded_at is null
  ) into v_slot;

  if not v_desc then v_missing := array_append(v_missing, 'description'); end if;
  if not v_photo then v_missing := array_append(v_missing, 'photo_principale'); end if;
  if not v_loc then v_missing := array_append(v_missing, 'localisation'); end if;
  if not v_stripe then v_missing := array_append(v_missing, 'stripe'); end if;
  if not v_product then v_missing := array_append(v_missing, 'product_with_photo'); end if;
  if not v_slot then v_missing := array_append(v_missing, 'open_slot'); end if;

  return jsonb_build_object(
    'found', true,
    'statut', v_producer.statut,
    'already_public', v_producer.statut = 'public',
    'publication_requested', v_producer.publication_requested_at is not null,
    'criteria', jsonb_build_object(
      'description', v_desc,
      'photo_principale', v_photo,
      'localisation', v_loc,
      'stripe', v_stripe,
      'product_with_photo', v_product,
      'open_slot', v_slot
    ),
    'missing', to_jsonb(v_missing),
    'all_ok', array_length(v_missing, 1) is null
  );
end;
$$;

revoke all on function public.get_publication_status(uuid) from public;
grant execute on function public.get_publication_status(uuid) to service_role;
