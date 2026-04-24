-- =============================================================================
-- TerrOir — Flags d'état réel de l'onboarding Stripe Connect sur producers
-- =============================================================================
-- Contexte : aujourd'hui producers.stripe_account_id est set DÈS la création
-- du compte Express (app/api/stripe/connect/onboard/route.ts), AVANT même que
-- le producer ait complété KYC/IBAN. La page /parametres affichait donc un
-- faux positif "✓ Compte Stripe connecté" dès qu'un account.id existait,
-- indépendamment de l'état réel de l'onboarding.
--
-- Ces 3 flags reflètent exactement les champs de l'objet Stripe.Account :
--   - charges_enabled     → le compte peut recevoir des paiements
--   - payouts_enabled     → le compte peut recevoir des virements bancaires
--   - details_submitted   → toutes les informations KYC ont été soumises
--
-- Ils sont mis à jour via le webhook account.updated (route
-- app/api/stripe/webhook/route.tsx, cf commit suivant du même chantier).
--
-- Un seul booléen "onboarding_completed" aurait mélangé les significations :
-- garder les 3 champs permet par exemple de distinguer "vérification en
-- cours mais KYC soumis" (pending attendu) de "KYC incomplet" (action
-- producer requise).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Ajout des 3 colonnes (NOT NULL DEFAULT false → backfill implicite à false
--    pour les rows existantes, ce qui est la sémantique correcte : tant que
--    Stripe n'a pas émis account.updated, on considère le compte non-ready.)
-- -----------------------------------------------------------------------------
alter table public.producers
  add column if not exists stripe_charges_enabled   boolean not null default false;

alter table public.producers
  add column if not exists stripe_payouts_enabled   boolean not null default false;

alter table public.producers
  add column if not exists stripe_details_submitted boolean not null default false;

-- -----------------------------------------------------------------------------
-- 2. Repatch delete_user_account : reset des 3 flags à false lors de
--    l'anonymisation producer, sinon incohérence sémantique (account_id nullé
--    mais charges_enabled=true reste figé). Copie conforme de la RPC existante
--    (cf 20260422200000_rgpd_account_deletion.sql) avec la clause UPDATE
--    producers étendue.
-- -----------------------------------------------------------------------------
create or replace function public.delete_user_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_producer_id            uuid;
  v_active_consumer_count  int;
  v_active_producer_count  int;
begin
  -- Guard 1 : l'appelant doit être l'user lui-même
  if auth.uid() is null or auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to delete this account'
      using errcode = '42501';
  end if;

  -- Localise le producer (optionnel)
  select id into v_producer_id
  from public.producers
  where user_id = p_user_id;

  -- Guard 2 : aucune commande active côté consumer
  select count(*) into v_active_consumer_count
  from public.orders
  where consumer_id = p_user_id
    and statut in ('pending', 'confirmed', 'ready');

  if v_active_consumer_count > 0 then
    raise exception 'Active consumer orders prevent deletion: %', v_active_consumer_count
      using errcode = 'P0001';
  end if;

  -- Guard 3 : aucune commande active côté producer (si applicable)
  if v_producer_id is not null then
    select count(*) into v_active_producer_count
    from public.orders
    where producer_id = v_producer_id
      and statut in ('pending', 'confirmed', 'ready');

    if v_active_producer_count > 0 then
      raise exception 'Active producer orders prevent deletion: %', v_active_producer_count
        using errcode = 'P0001';
    end if;
  end if;

  -- 1. Hard-delete des reviews écrites par l'user
  delete from public.reviews where consumer_id = p_user_id;

  -- 2. Anonymisation des orders passées (comptabilité 10 ans)
  update public.orders
     set consumer_id = null,
         notes_client = null
   where consumer_id = p_user_id;

  -- 3. Branche producer : hard-delete dépendances + anonymisation
  if v_producer_id is not null then
    delete from public.reviews  where producer_id = v_producer_id;
    delete from public.products where producer_id = v_producer_id;
    delete from public.slots    where producer_id = v_producer_id;

    update public.producers
       set user_id                  = null,
           adresse                  = null,
           latitude                 = null,
           longitude                = null,
           description              = null,
           histoire                 = null,
           photo_principale         = null,
           photos                   = null,
           stripe_account_id        = null,
           stripe_charges_enabled   = false,
           stripe_payouts_enabled   = false,
           stripe_details_submitted = false,
           statut                   = 'deleted',
           deleted_at               = now()
     where id = v_producer_id;
  end if;

  -- public.users sera supprimé par CASCADE lors du
  -- supabase.auth.admin.deleteUser() côté serveur. Idem notifications.
end;
$$;

grant execute on function public.delete_user_account(uuid) to authenticated;

commit;
