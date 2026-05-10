-- =============================================================================
-- TerrOir — F-009 : trigger BEFORE UPDATE bloque colonnes protégées public.users
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-009) : la policy
-- "Users can update their own profile" sur public.users autorise tout user
-- authentifié à modifier sa propre ligne sans contrainte WITH CHECK sur les
-- colonnes sensibles. Conséquence :
--   • roles : auto-promotion 'consumer' → ['consumer','admin'] possible via
--     PATCH /rest/v1/users?id=eq.<own> body {roles: ['consumer','admin']}.
--     Privilege escalation totale (passe is_admin() check → toutes les RPC
--     admin-only deviennent accessibles).
--   • email : désynchro auth.users (source de vérité GoTrue) ↔ public.users.
--     Permet aussi un attaquant de poser un email arbitraire dans
--     public.users sans validation OTP (contourne flow A3 T-013 PR2).
--   • id : immuable par design (PK shared with auth.users).
--   • stripe_customer_id : lier le user à un autre customer Stripe = vol de
--     payment methods enregistrés.
--   • cgu_accepted_at / cgu_version : tampering preuve d'acceptation CGU
--     (probatoire juridique).
--
-- Tous les writes légitimes sur ces colonnes passent par service_role :
--   • roles → accept-invitation.ts, login-and-upgrade.ts (admin client)
--   • email → complete-email-change.tsx (admin client après verifyOtp + sync
--     auth.users via auth.admin.updateUserById)
--   • stripe_customer_id → lib/stripe/customer.ts (admin client lors du
--     premier checkout)
--   • cgu_accepted_at / cgu_version → server action /cgu/accept (service_role)
--
-- Pattern identique à T-218 (producers_block_owner_admin_columns) : trigger
-- BEFORE UPDATE, bypass service_role + is_admin(), RAISE EXCEPTION
-- ERRCODE 42501 (insufficient_privilege) si colonne protégée modifiée.
--
-- Defense in depth : le code applicatif ne touche pas ces colonnes via le
-- client cookie SSR / browser. Trigger = ceinture qui bloque une requête
-- PostgREST manuelle hostile.
-- =============================================================================

create or replace function public.users_block_owner_protected_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;

  if (select public.is_admin()) then
    return new;
  end if;

  if new.roles is distinct from old.roles then
    raise exception 'users.roles is admin-only (F-009)' using errcode = '42501';
  end if;

  if new.email is distinct from old.email then
    raise exception 'users.email is admin-only (F-009)' using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'users.id is immutable (F-009)' using errcode = '42501';
  end if;

  if new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'users.stripe_customer_id is admin-only (F-009)' using errcode = '42501';
  end if;

  if new.cgu_accepted_at is distinct from old.cgu_accepted_at then
    raise exception 'users.cgu_accepted_at is admin-only (F-009)' using errcode = '42501';
  end if;

  if new.cgu_version is distinct from old.cgu_version then
    raise exception 'users.cgu_version is admin-only (F-009)' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists users_block_owner_protected_columns_trigger on public.users;

create trigger users_block_owner_protected_columns_trigger
before update on public.users
for each row
execute function public.users_block_owner_protected_columns();
