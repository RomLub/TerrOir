-- =============================================================================
-- TerrOir — F-030 : table public.deleted_users (audit forensique post-cascade)
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-030) : lors d'une
-- suppression de compte (admin.auth.admin.deleteUser), auth.users est
-- supprimé puis public.users via CASCADE. audit_logs.user_id n'a PAS de FK
-- (cf. inspection schema), donc la valeur UUID survit telle quelle dans
-- audit_logs. Cependant aucune trace centralisée ne dit "ce UUID a été
-- supprimé le YYYY-MM-DD" → un admin investiguant un event audit ancien
-- ne peut pas distinguer un UUID inconnu d'un UUID supprimé.
--
-- F-030 ajoute :
--   • public.deleted_users(id, deleted_at, deletion_reason) — tombstone
--     persistant
--   • Trigger AFTER DELETE ON auth.users → INSERT INTO deleted_users
--   • RPC SECDEF get_user_deletion_status(uuid) — admin lookup
--   • RLS admin-only sur deleted_users
--
-- Finalité légitime art 6.1.f RGPD : intérêt légitime sécurité (forensique
-- audit logs incident, traçabilité comptes supprimés, lutte contre fraude
-- post-deletion). Tombstone minimal (id, date, raison) — aucune donnée
-- personnelle au-delà de l'UUID. Anonymisation conforme : l'UUID seul
-- n'identifie pas l'individu sans accès à un système tiers.
--
-- Rétention : tombstone persistant tant que des audit_logs référencent
-- l'UUID. Politique de purge à définir ultérieurement (cohérent rétention
-- audit_logs = 10 ans comptable).
-- =============================================================================

create table if not exists public.deleted_users (
  id uuid primary key,
  deleted_at timestamptz not null default now(),
  deletion_reason text not null default 'rgpd_self_deletion'
);

comment on table public.deleted_users is
  'Tombstone des comptes supprimés (auth.users DELETE). Finalité légitime art 6.1.f RGPD : forensique audit logs post-suppression, traçabilité incidents, anti-fraude. Aucune donnée personnelle au-delà de l''UUID original (déjà présent dans audit_logs.user_id non-cascade).';

comment on column public.deleted_users.id is
  'UUID original de auth.users (preserved on DELETE via trigger log_auth_user_deletion).';

comment on column public.deleted_users.deletion_reason is
  'Raison de la suppression. Default ''rgpd_self_deletion'' (flow consumer self-delete via delete_user_account RPC + admin.auth.admin.deleteUser). Valeurs futures possibles : ''admin_action'', ''gdpr_request'', ''spam_purge''.';

-- =============================================================================
-- Trigger function : log_auth_user_deletion
-- =============================================================================
create or replace function public.log_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.deleted_users (id, deleted_at, deletion_reason)
  values (old.id, now(), 'rgpd_self_deletion')
  on conflict (id) do nothing;
  return old;
end;
$$;

revoke execute on function public.log_auth_user_deletion() from public;

drop trigger if exists log_auth_user_deletion_trigger on auth.users;

create trigger log_auth_user_deletion_trigger
after delete on auth.users
for each row
execute function public.log_auth_user_deletion();

-- =============================================================================
-- RPC : get_user_deletion_status(uuid)
-- =============================================================================
-- Doctrine T-295-bis : SECDEF + REVOKE EXECUTE PUBLIC/anon/authenticated +
-- GRANT EXECUTE service_role exclusivement. L'admin server action vérifie
-- isAdmin côté serveur AVANT d'appeler la RPC via admin client.
create or replace function public.get_user_deletion_status(p_user_id uuid)
returns table (
  is_deleted boolean,
  deleted_at timestamptz,
  deletion_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select
    (du.id is not null) as is_deleted,
    du.deleted_at,
    du.deletion_reason
  from (select 1) dummy
  left join public.deleted_users du on du.id = p_user_id;
end;
$$;

revoke execute on function public.get_user_deletion_status(uuid) from public, anon, authenticated;
grant execute on function public.get_user_deletion_status(uuid) to service_role;

-- =============================================================================
-- RLS sur deleted_users
-- =============================================================================
alter table public.deleted_users enable row level security;
alter table public.deleted_users force row level security;

drop policy if exists "deleted_users admin select" on public.deleted_users;
create policy "deleted_users admin select"
on public.deleted_users
for select
using (public.is_admin());

drop policy if exists "deleted_users service role only writes" on public.deleted_users;
create policy "deleted_users service role only writes"
on public.deleted_users
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

revoke all on table public.deleted_users from public, anon;
grant select on table public.deleted_users to authenticated;
grant all on table public.deleted_users to service_role;

-- =============================================================================
-- Vue utilitaire : audit_logs_with_deletion_status
-- =============================================================================
-- Vue admin pour audit forensique : LEFT JOIN audit_logs avec deleted_users
-- pour distinguer "UUID inconnu" vs "UUID supprimé le YYYY-MM-DD". Pas de
-- WHERE filter — l'admin filtre côté requête (date range, event_type, etc).
-- RLS hérite de la table audit_logs (admin only).
create or replace view public.audit_logs_with_deletion_status as
select
  al.id,
  al.user_id,
  al.event_type,
  al.metadata,
  al.ip_address,
  al.user_agent,
  al.created_at,
  (du.id is not null) as user_is_deleted,
  du.deleted_at as user_deleted_at,
  du.deletion_reason as user_deletion_reason
from public.audit_logs al
left join public.deleted_users du on du.id = al.user_id;

comment on view public.audit_logs_with_deletion_status is
  'F-030 audit P0 sweep — Audit logs enrichi avec statut suppression user. Admin only via RLS hérité (audit_logs + deleted_users sont admin-only).';

revoke all on table public.audit_logs_with_deletion_status from public, anon;
grant select on table public.audit_logs_with_deletion_status to authenticated;
grant select on table public.audit_logs_with_deletion_status to service_role;
