-- =============================================================================
-- Reconstitution de migration apply via MCP — 2026-05-05
-- =============================================================================
-- Apply effectué via MCP apply_migration le 2026-05-05 avant création de ce
-- fichier — version_id auto-généré 20260505115937. Ce fichier reconstitue le
-- SQL pour cohérence repo ↔ prod (corrige finding N-1 de l'audit régression).
--
-- Référence audits :
--   docs/audits/audit-auth-2026-05-05.md            (findings H-1, H-2)
--   docs/audits/audit-auth-regression-2026-05-05.md (finding N-1 — drift)
--
-- Préfixe local 20260505200050 choisi pour s'intercaler entre 20260505200000
-- (LOT 0 — search_path_t241, version_id MCP 115433) et 20260505200100
-- (LOT B — rate_limit producer_interests, version_id MCP 120505), respectant
-- l'ordre temporel d'apply MCP : 115433 → 115937 → 120505.
--
-- NE PAS apply : déjà en prod sous version_id 20260505115937 (cf.
-- supabase_migrations.schema_migrations). Ce fichier sert uniquement à
-- garantir que `supabase db reset --linked` reproduise fidèlement l'état
-- prod en dev / staging.
-- =============================================================================

-- =============================================================================
-- Audit Auth 2026-05-05 — finding H-1 (purge RGPD product_stock_alerts)
-- Référence : docs/audits/audit-auth-2026-05-05.md H-1
--
-- Étend public.delete_user_account pour hard-delete les rows
-- product_stock_alerts liées à l'user supprimé. La FK consumer_id →
-- auth.users est ON DELETE SET NULL : sans ce delete explicite, les
-- colonnes email, confirm_token, unsubscribe_token survivent au compte
-- (non-conformité RGPD article 17).
--
-- Signature inchangée. ACL inchangée (authenticated — le server action
-- appelle la RPC via supabase.rpc, et le guard interne auth.uid() =
-- p_user_id exige un JWT context). SECURITY DEFINER + search_path
-- (public, pg_temp) inchangés.
-- =============================================================================

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

  -- 4. Hard-delete product_stock_alerts (finding H-1, RGPD article 17).
  --    FK consumer_id ON DELETE SET NULL → sans ce delete explicite,
  --    email + confirm_token + unsubscribe_token survivraient au compte.
  delete from public.product_stock_alerts where consumer_id = p_user_id;

  -- public.users sera supprimé par CASCADE lors du
  -- supabase.auth.admin.deleteUser() côté serveur. Idem notifications.
end;
$$;
