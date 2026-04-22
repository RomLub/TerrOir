-- =============================================================================
-- TerrOir — RGPD : suppression de compte self-service
-- =============================================================================
-- Ajoute le statut 'deleted' pour les producers anonymisés + colonnes audit
-- (deleted_at, stripe_cleanup_pending), et fournit la RPC orchestrant la
-- séquence d'anonymisation / hard-delete côté données applicatives.
--
-- La suppression de auth.users elle-même se fait côté serveur via
-- supabase.auth.admin.deleteUser() (service_role API) et cascade dans
-- public.users + public.notifications. Cette RPC traite tout ce qui
-- bloquerait ce CASCADE (FK NO ACTION vers public.users et public.producers).
--
-- Politique RGPD (décision produit 22/04/2026) :
--   Consumer : anonymise orders (consumer_id=NULL, notes_client=NULL)
--              hard-delete reviews écrites
--   Producer : hard-delete products + slots + reviews reçues
--              anonymise producers (user_id=NULL, scrub PII) → statut='deleted'
--              conserve nom_exploitation, siret, commune, code_postal, badges,
--              created_at (trace comptable + payouts intacts)
--
-- RLS inchangée : les policies existantes (statut='public' pour le public,
-- is_admin() pour le back-office) filtrent naturellement les producers
-- 'deleted'. Admin conserve la visibilité via "producers admin all".
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. CHECK constraint producers.statut : ajoute 'deleted'
-- -----------------------------------------------------------------------------
-- Drop dynamique pour tolérer le nom actuel (cf migration 20260421300000).
do $$
declare
  c_name text;
begin
  for c_name in
    select conname
    from pg_constraint
    where conrelid = 'public.producers'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%statut%'
  loop
    execute format('alter table public.producers drop constraint %I', c_name);
  end loop;
end $$;

alter table public.producers
  add constraint producers_statut_check
  check (statut in ('draft', 'pending', 'active', 'public', 'suspended', 'deleted'));

-- -----------------------------------------------------------------------------
-- 2. Colonnes audit
-- -----------------------------------------------------------------------------
alter table public.producers
  add column if not exists deleted_at timestamptz;

-- Flag levé par le server action si stripe.accounts.del() échoue
-- → à traiter manuellement depuis le back-office admin.
alter table public.producers
  add column if not exists stripe_cleanup_pending boolean not null default false;

-- -----------------------------------------------------------------------------
-- 3. RPC delete_user_account(p_user_id)
-- -----------------------------------------------------------------------------
-- Appelée par le server action de suppression. SECURITY DEFINER pour bypass
-- RLS sur tables dépendantes. Guard `auth.uid() = p_user_id` protège contre
-- l'appel par un autre user. Transaction implicite Postgres = atomique.
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
    -- Reviews reçues : hard-delete (opinions sur producer qui disparaît)
    delete from public.reviews where producer_id = v_producer_id;

    -- Produits + slots : hard-delete (pas de valeur comptable)
    delete from public.products where producer_id = v_producer_id;
    delete from public.slots    where producer_id = v_producer_id;

    -- Anonymise le producer (garde traces comptables non-PII)
    update public.producers
       set user_id           = null,
           adresse           = null,
           latitude          = null,
           longitude         = null,
           description       = null,
           histoire          = null,
           photo_principale  = null,
           photos            = null,
           stripe_account_id = null,
           statut            = 'deleted',
           deleted_at        = now()
     where id = v_producer_id;
  end if;

  -- public.users sera supprimé par CASCADE lors du
  -- supabase.auth.admin.deleteUser() côté serveur. Idem notifications.
end;
$$;

grant execute on function public.delete_user_account(uuid) to authenticated;

commit;
