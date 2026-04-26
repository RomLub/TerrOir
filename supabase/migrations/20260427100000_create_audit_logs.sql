-- =============================================================================
-- TerrOir — table audit_logs (trace forensique events sensibles)
-- =============================================================================
-- Trace immuable des events critiques (auth, paiements, RGPD, admin) à des
-- fins de conformité (RGPD article 32 — registre des traitements, PCI DSS
-- 10.x — audit trail) et d'investigation forensique en cas d'incident
-- (compromission de compte, dispute Stripe, demande judiciaire).
--
-- Périmètre Phase 1 (cette migration) : auth uniquement
--   - password_reset_request : demande de reset (email saisi, user inconnu)
--   - password_changed       : nouveau mot de passe posé
--   - account_login_password : login signInWithPassword réussi
--   - account_login_magic_link : envoi magic link (user inconnu côté serveur)
--   - account_logout         : signOut côté server action
--
-- Périmètre futur (à instrumenter au fil de l'eau, pas de migration nécessaire) :
--   account_signup, account_email_change, account_deletion, role_change,
--   admin_login, payment_*, refund_*, etc. → simplement pousser un nouveau
--   event_type dans la table.
--
-- RLS : table verrouillée. Lecture admin only (lookup via admin_users.id =
-- auth.uid()). Écriture exclusivement via service_role depuis le serveur
-- applicatif (helper lib/audit-logs/log-auth-event.ts) — aucun client
-- authenticated ne doit insérer directement, sinon les logs deviennent
-- forgeables. Pas de UPDATE/DELETE policies → table append-only de fait
-- (service_role bypass mais convention applicative stricte).
--
-- ON DELETE SET NULL sur user_id : si l'user est supprimé (RGPD self-service,
-- cf. 20260422200000), les logs anciens restent traçables anonymement
-- (event_type + IP + UA + metadata), conforme à l'obligation de conservation
-- des logs sécurité (≥ 1 an recommandé CNIL) tout en respectant le droit à
-- l'effacement sur les données identifiantes.
--
-- metadata JSONB : payload extensible par event_type (email pour magic_link
-- non encore identifié, raison pour suspended, etc.). Pas de schéma figé
-- pour ne pas bloquer l'évolution.
-- =============================================================================

begin;

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  event_type  text not null,
  metadata    jsonb not null default '{}'::jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_user_id    on public.audit_logs(user_id);
create index if not exists idx_audit_logs_event_type on public.audit_logs(event_type);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);

alter table public.audit_logs enable row level security;

-- Lecture : admin only (cohérent avec admin_users.id = auth.uid() utilisé
-- ailleurs dans le schéma, cf. 20260421100000_cumulative_roles_admin_users.sql).
drop policy if exists "audit_logs admin read" on public.audit_logs;
create policy "audit_logs admin read"
  on public.audit_logs
  for select
  to authenticated
  using (exists (
    select 1 from public.admin_users where id = auth.uid()
  ));

-- Pas de policy INSERT : seul service_role (qui bypass RLS) peut écrire.
-- Pas de policy UPDATE/DELETE : table append-only par design.

commit;
