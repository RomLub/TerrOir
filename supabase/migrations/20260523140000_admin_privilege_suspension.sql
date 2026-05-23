-- Chantier 6 — Page Admins : niveaux de privilège + suspension des comptes
-- administrateurs, avec RPC atomiques pour les opérations du cycle de vie.
--
-- Contexte architecture (vérifié en prod) :
--   - admin_users et public.users sont MUTUELLEMENT EXCLUSIFS par id
--     (trigger enforce_user_exclusive). Un admin n'est jamais dans
--     public.users. Conséquence : « promouvoir » = MOVE users→admin_users,
--     « retirer » = MOVE admin_users→users — DELETE + INSERT atomiques dans
--     une seule transaction (ces RPC). Les FK orders/reviews/producers →
--     users(id) sont NO ACTION : un compte avec activité client ne peut PAS
--     être promu (le DELETE users serait bloqué) → garde explicite.
--   - admin_users.id et users.id pointent tous deux sur auth.users(id)
--     (ON DELETE CASCADE) : un MOVE préserve l'identité de connexion.
--   - Le middleware cache isAdmin dans un snapshot signé, invalidé par
--     touch_role_snapshot_revocation (trigger INSERT/DELETE de admin_users).
--     La SUSPENSION étant un UPDATE, on étend le trigger à UPDATE OF
--     suspended_at, sinon un admin suspendu garderait l'accès via snapshot.
--
-- Forward-only, idempotent.

-- 1. Enum des niveaux de privilège admin.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_privilege') then
    create type public.admin_privilege as enum ('super_admin', 'standard');
  end if;
end $$;

-- 2. Colonnes admin_privilege + suspended_at.
alter table public.admin_users
  add column if not exists admin_privilege public.admin_privilege not null default 'standard';
alter table public.admin_users
  add column if not exists suspended_at timestamptz;

-- 3. Bootstrap : les admins existants (fondateurs) → super_admin.
update public.admin_users set admin_privilege = 'super_admin'
where admin_privilege = 'standard';

-- 4. Snapshot revoke : gérer aussi l'UPDATE (suspension/réactivation), sinon
--    un admin suspendu garderait isAdmin=true via le snapshot caché.
create or replace function public.on_admin_users_changed_revoke_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.touch_role_snapshot_revocation(new.id);
  elsif tg_op = 'DELETE' then
    perform public.touch_role_snapshot_revocation(old.id);
  elsif tg_op = 'UPDATE' then
    perform public.touch_role_snapshot_revocation(new.id);
  end if;
  return null;
end;
$function$;

drop trigger if exists admin_users_revoke_role_snapshot on public.admin_users;
create trigger admin_users_revoke_role_snapshot
  after insert or delete or update of suspended_at on public.admin_users
  for each row execute function public.on_admin_users_changed_revoke_snapshot();

-- 5. Helper interne : actor est-il un super_admin actif ?
create or replace function public.is_active_super_admin(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.admin_users
    where id = p_actor
      and admin_privilege = 'super_admin'
      and suspended_at is null
  );
$function$;

-- Helper interne : nombre de super_admins actifs (pour la garde « dernier »).
create or replace function public.count_active_super_admins()
returns int
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::int from public.admin_users
  where admin_privilege = 'super_admin' and suspended_at is null;
$function$;

-- 6a. Promotion d'un compte client en admin (MOVE users → admin_users).
create or replace function public.admin_promote_user(
  p_actor uuid,
  p_target uuid,
  p_privilege public.admin_privilege default 'standard'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email text;
  v_prenom text;
  v_nom text;
begin
  if not public.is_active_super_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error_code', 'forbidden');
  end if;
  if exists (select 1 from public.admin_users where id = p_target) then
    return jsonb_build_object('ok', false, 'error_code', 'already_admin');
  end if;
  if not exists (select 1 from public.users where id = p_target) then
    return jsonb_build_object('ok', false, 'error_code', 'target_not_found');
  end if;
  -- Garde FK : un compte avec activité client ne peut pas être déplacé
  -- (DELETE users bloqué par orders/reviews/producers NO ACTION).
  if exists (select 1 from public.orders where consumer_id = p_target)
     or exists (select 1 from public.reviews where consumer_id = p_target)
     or exists (select 1 from public.producers where user_id = p_target) then
    return jsonb_build_object('ok', false, 'error_code', 'has_client_activity');
  end if;

  select email, prenom, nom into v_email, v_prenom, v_nom
  from public.users where id = p_target;

  -- MOVE atomique : delete users (cascade notif prefs) puis insert admin_users.
  delete from public.users where id = p_target;
  insert into public.admin_users (id, email, prenom, nom, admin_privilege)
  values (p_target, v_email, v_prenom, v_nom, p_privilege);

  return jsonb_build_object('ok', true);
end;
$function$;

-- 6b. Retrait du statut admin (MOVE admin_users → users, redevient client).
create or replace function public.admin_revoke(
  p_actor uuid,
  p_target uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email text;
  v_prenom text;
  v_nom text;
  v_priv public.admin_privilege;
  v_suspended timestamptz;
begin
  if not public.is_active_super_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error_code', 'forbidden');
  end if;
  if p_actor = p_target then
    return jsonb_build_object('ok', false, 'error_code', 'self_action');
  end if;
  select email, prenom, nom, admin_privilege, suspended_at
    into v_email, v_prenom, v_nom, v_priv, v_suspended
  from public.admin_users where id = p_target;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_admin');
  end if;
  -- Garde « dernier super_admin actif » : ne jamais retirer le dernier.
  if v_priv = 'super_admin' and v_suspended is null
     and public.count_active_super_admins() <= 1 then
    return jsonb_build_object('ok', false, 'error_code', 'last_super_admin');
  end if;

  -- MOVE atomique : delete admin_users puis insert users (rôle consumer).
  delete from public.admin_users where id = p_target;
  insert into public.users (id, email, prenom, nom, roles)
  values (p_target, v_email, v_prenom, v_nom, array['consumer']);

  return jsonb_build_object('ok', true);
end;
$function$;

-- 6c. Suspension d'un admin (UPDATE suspended_at → snapshot révoqué).
create or replace function public.admin_suspend(
  p_actor uuid,
  p_target uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_priv public.admin_privilege;
  v_suspended timestamptz;
begin
  if not public.is_active_super_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error_code', 'forbidden');
  end if;
  if p_actor = p_target then
    return jsonb_build_object('ok', false, 'error_code', 'self_action');
  end if;
  select admin_privilege, suspended_at into v_priv, v_suspended
  from public.admin_users where id = p_target;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_admin');
  end if;
  if v_suspended is not null then
    return jsonb_build_object('ok', false, 'error_code', 'already_suspended');
  end if;
  if v_priv = 'super_admin' and public.count_active_super_admins() <= 1 then
    return jsonb_build_object('ok', false, 'error_code', 'last_super_admin');
  end if;

  update public.admin_users set suspended_at = now() where id = p_target;
  return jsonb_build_object('ok', true);
end;
$function$;

-- 6d. Réactivation d'un admin suspendu.
create or replace function public.admin_reactivate(
  p_actor uuid,
  p_target uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_suspended timestamptz;
begin
  if not public.is_active_super_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error_code', 'forbidden');
  end if;
  select suspended_at into v_suspended
  from public.admin_users where id = p_target;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_admin');
  end if;
  if v_suspended is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_suspended');
  end if;

  update public.admin_users set suspended_at = null where id = p_target;
  return jsonb_build_object('ok', true);
end;
$function$;

-- 6e. Changement de niveau (super_admin ↔ standard).
create or replace function public.admin_set_privilege(
  p_actor uuid,
  p_target uuid,
  p_privilege public.admin_privilege
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_priv public.admin_privilege;
  v_suspended timestamptz;
begin
  if not public.is_active_super_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error_code', 'forbidden');
  end if;
  if p_actor = p_target then
    return jsonb_build_object('ok', false, 'error_code', 'self_action');
  end if;
  select admin_privilege, suspended_at into v_priv, v_suspended
  from public.admin_users where id = p_target;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_admin');
  end if;
  if v_priv = p_privilege then
    return jsonb_build_object('ok', false, 'error_code', 'no_change');
  end if;
  -- Rétrograder le dernier super_admin actif → interdit.
  if v_priv = 'super_admin' and p_privilege = 'standard'
     and v_suspended is null and public.count_active_super_admins() <= 1 then
    return jsonb_build_object('ok', false, 'error_code', 'last_super_admin');
  end if;

  update public.admin_users set admin_privilege = p_privilege where id = p_target;
  return jsonb_build_object('ok', true);
end;
$function$;

-- 7. Grants : RPC appelées exclusivement via service_role depuis les routes
--    Next (actor vérifié côté session ET re-vérifié dans la RPC). Helpers
--    internes idem.
grant execute on function public.is_active_super_admin(uuid) to service_role;
grant execute on function public.count_active_super_admins() to service_role;
grant execute on function public.admin_promote_user(uuid, uuid, public.admin_privilege) to service_role;
grant execute on function public.admin_revoke(uuid, uuid) to service_role;
grant execute on function public.admin_suspend(uuid, uuid) to service_role;
grant execute on function public.admin_reactivate(uuid, uuid) to service_role;
grant execute on function public.admin_set_privilege(uuid, uuid, public.admin_privilege) to service_role;
