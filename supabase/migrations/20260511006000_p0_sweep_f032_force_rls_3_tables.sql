-- =============================================================================
-- TerrOir — F-032 : FORCE RLS sur 3 tables sensibles
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-032). Pour les
-- tables sensibles, ENABLE ROW LEVEL SECURITY suffit pour les requêtes user
-- (authenticated, anon) mais le owner de la table (postgres / supabase_admin)
-- bypass les policies par défaut. FORCE ROW LEVEL SECURITY étend l'enforcement
-- au owner — defense-in-depth contre :
--   • un superuser SQL Studio qui oublie SET ROLE service_role
--   • un trigger / RPC SECDEF qui assume RLS-by-default
--   • un script ops qui exécute du SQL via psql en superuser
--
-- Doctrine TerrOir alignée FORCE RLS : déjà appliqué T-218 (producers),
-- T-218-bis (producers lat/lng), T-295-bis (RPC tightening). F-032 étend
-- aux 3 tables sensibles qui ne l'avaient pas :
--   • public.notifications     (PII consumer : email log, contenu template)
--   • public.email_suppressions (PII : adresses email bounce/complaint Resend)
--   • public.admin_users        (privilege escalation : rôles admin)
--
-- Idempotence (doctrine T-297) : ALTER TABLE FORCE est idempotent —
-- répéter le statement est no-op (vs DROP/CREATE qui casserait).
-- =============================================================================

alter table public.notifications force row level security;
alter table public.email_suppressions force row level security;
alter table public.admin_users force row level security;

comment on table public.notifications is
  'Log envois email/notifications. RLS forcé (F-032 audit P0 sweep 2026-05-11) — owner bypass désactivé, service_role obligatoire pour writes hors policies user. Contient PII (email contenu rendu).';

comment on table public.email_suppressions is
  'Liste suppressions Resend (bounce permanent, complaint). RLS forcé (F-032 audit P0 sweep 2026-05-11) — owner bypass désactivé. Contient PII (adresses email).';

comment on table public.admin_users is
  'Whitelist admins TerrOir (privilege escalation). RLS forcé (F-032 audit P0 sweep 2026-05-11) — owner bypass désactivé. Toute mutation doit passer par service_role explicite.';
