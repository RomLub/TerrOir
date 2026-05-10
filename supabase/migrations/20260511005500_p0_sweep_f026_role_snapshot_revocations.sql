-- =============================================================================
-- TerrOir — F-026 : révocation serveur du role snapshot HMAC (anti-stale 15min)
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-026). Le cache role
-- snapshot (T-321, cf. lib/auth/role-snapshot-cookie.ts) signe HMAC un cookie
-- valide 15 minutes — ce qui économise 2 queries DB par request authentifiée
-- mais introduit une fenêtre de staleness : si un admin retire un rôle à un
-- user (ou ajoute admin_users), le user continue à utiliser son cookie cached
-- jusqu'à 15 minutes.
--
-- Cette migration pose une table tombstone par-user `role_snapshot_revocations`
-- + un trigger sur public.users qui pose un min_issued_at = now() à chaque
-- UPDATE de roles. Le middleware consulte cette table pour invalider les
-- snapshots dont expires_at - TTL < min_issued_at.
--
-- Schéma :
--   role_snapshot_revocations(
--     user_id        uuid PK references auth.users(id) on delete cascade,
--     min_issued_at  timestamptz not null default now()
--   )
--
-- Trigger AFTER UPDATE OF roles ON public.users :
--   INSERT (user_id, now()) ON CONFLICT (user_id) DO UPDATE
--     SET min_issued_at = now()
--
-- Symétrique pour admin_users INSERT/DELETE : un admin promotion/revocation
-- doit aussi invalider le cookie isAdmin.
--
-- Idempotence (doctrine T-297) : CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, DROP TRIGGER IF EXISTS.
-- =============================================================================

create table if not exists public.role_snapshot_revocations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  min_issued_at timestamptz not null default now()
);

comment on table public.role_snapshot_revocations is
  'F-026 audit P0 sweep — Tombstone par-user pour invalider les snapshots role HMAC (cookie cache T-321) stale. min_issued_at = timestamp avant lequel tous les snapshots émis doivent être considérés invalides (force middleware refresh DB).';

comment on column public.role_snapshot_revocations.min_issued_at is
  'Tout snapshot dont expires_at - 15min < min_issued_at doit être considéré stale. Updated par trigger ON UPDATE public.users(roles) + ON INSERT/DELETE public.admin_users.';

-- =============================================================================
-- Trigger function : touch_role_snapshot_revocation
-- =============================================================================
-- Pose min_issued_at = now() pour le user concerné. Idempotent via UPSERT.
create or replace function public.touch_role_snapshot_revocation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.role_snapshot_revocations (user_id, min_issued_at)
  values (p_user_id, now())
  on conflict (user_id) do update set min_issued_at = now();
end;
$$;

revoke execute on function public.touch_role_snapshot_revocation(uuid) from public;

-- Trigger sur public.users : roles change → revoke snapshot.
create or replace function public.on_users_roles_changed_revoke_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Trigger arming via WHEN clause sur le CREATE TRIGGER ci-dessous —
  -- on entre ici uniquement si roles a vraiment changé.
  perform public.touch_role_snapshot_revocation(new.id);
  return new;
end;
$$;

revoke execute on function public.on_users_roles_changed_revoke_snapshot() from public;

drop trigger if exists users_roles_revoke_role_snapshot on public.users;

create trigger users_roles_revoke_role_snapshot
after update of roles on public.users
for each row
when (old.roles is distinct from new.roles)
execute function public.on_users_roles_changed_revoke_snapshot();

-- Trigger sur public.admin_users : INSERT/DELETE → revoke snapshot (le bit
-- isAdmin du snapshot est cached aussi).
create or replace function public.on_admin_users_changed_revoke_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.touch_role_snapshot_revocation(new.id);
  elsif tg_op = 'DELETE' then
    perform public.touch_role_snapshot_revocation(old.id);
  end if;
  return null; -- AFTER trigger : return value ignored
end;
$$;

revoke execute on function public.on_admin_users_changed_revoke_snapshot() from public;

drop trigger if exists admin_users_revoke_role_snapshot on public.admin_users;

create trigger admin_users_revoke_role_snapshot
after insert or delete on public.admin_users
for each row
execute function public.on_admin_users_changed_revoke_snapshot();

-- =============================================================================
-- RLS sur role_snapshot_revocations
-- =============================================================================
-- Lecture : service_role only (middleware Edge utilise anon client + getUser,
-- pas service_role — donc l'expose pas. La consultation est via une RPC
-- SECDEF ci-dessous qui peut être appelée par anon avec garde sur user_id).
alter table public.role_snapshot_revocations enable row level security;
alter table public.role_snapshot_revocations force row level security;

drop policy if exists "role_snapshot_revocations service role all" on public.role_snapshot_revocations;
create policy "role_snapshot_revocations service role all"
on public.role_snapshot_revocations
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

revoke all on table public.role_snapshot_revocations from public, anon, authenticated;
grant all on table public.role_snapshot_revocations to service_role;

-- =============================================================================
-- RPC SECDEF : get_role_snapshot_revocation(uuid)
-- =============================================================================
-- Permet au middleware (qui utilise un client anon Supabase via createServerClient)
-- de consulter min_issued_at d'un user sans bypass RLS. SECDEF + scope strict
-- p_user_id obligatoire. authenticated/anon peuvent appeler mais avec leur
-- propre user_id (le middleware passe user.id de la session courante).
--
-- Retour : timestamp (peut être null si aucune révocation enregistrée — cas
-- nominal pour un user qui n'a jamais eu de changement de rôle).
create or replace function public.get_role_snapshot_revocation(p_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_min timestamptz;
begin
  select min_issued_at into v_min
    from public.role_snapshot_revocations
    where user_id = p_user_id;
  return v_min;
end;
$$;

revoke execute on function public.get_role_snapshot_revocation(uuid) from public;
grant execute on function public.get_role_snapshot_revocation(uuid)
  to anon, authenticated, service_role;

comment on function public.get_role_snapshot_revocation(uuid) is
  'F-026 audit P0 sweep — Lookup min_issued_at pour un user. Appelé par middleware Edge avec le user_id de la session courante pour valider la fraîcheur du cookie role snapshot HMAC. SECDEF mais grant authenticated/anon : pas de fuite (le user demande la révocation de son PROPRE snapshot, info publique au sens où elle dit juste "votre snapshot est invalidé").';
