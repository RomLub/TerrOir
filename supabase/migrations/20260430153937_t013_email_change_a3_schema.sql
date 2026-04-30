-- =============================================================================
-- TerrOir — T-013 / T-014 : flow A3 change_email (Amazon-like) + UNIQUE email
-- =============================================================================
-- Bascule depuis Supabase Secure Email Change (double confirmation par lien
-- magique asynchrone) vers un flow custom 2 OTP successifs in-session +
-- email d'annulation post-fait à l'ancien email (modèle Amazon-like).
--
-- Cette migration pose UNIQUEMENT le schéma DB. Le code applicatif est livré
-- en PR2 (server actions OTP + UI stepper) et PR3 (route undo + mail Resend).
--
-- Périmètre :
--   1. UNIQUE constraint preventive sur public.users.email (case-insensitive)
--      → audit prod 30/04/2026 confirme 0 doublon, apply non bloquant.
--   2. Table public.email_change_otp_codes : OTP éphémères 6 chiffres pour les
--      2 étapes (current = email actuel, new = email cible). Code hashé en DB
--      (jamais en clair). Expiration 10 min, cap 5 attempts par token.
--   3. Table public.email_change_undo_tokens : tokens d'annulation valides 7
--      jours, envoyés à l'ANCIEN email post-completion. Token hashé en DB.
--
-- Toggle Dashboard Supabase Auth > Email > "Secure email change" : laissé ON
-- volontairement comme filet de sécurité (l'API admin auth.admin.updateUserById
-- utilisée par le flow A3 bypass ce toggle ; ON conservé pour qu'un éventuel
-- ré-usage accidentel de auth.updateUser({email}) reste bloqué par double
-- confirmation Supabase plutôt que de devenir 1-clic vulnérable).
--
-- RLS : tables verrouillées, aucune policy. Service_role only via les helpers
-- server-side (cohérent pattern audit_logs cf. 20260427100000). Aucun client
-- authenticated ne doit lire ou écrire ces tables directement.
--
-- ON DELETE CASCADE sur auth.users(id) : si user supprimé (RGPD self-service
-- cf. 20260422200000), tokens et OTP nettoyés automatiquement.
--
-- Pre-flight check à exécuter MANUELLEMENT avant l'apply (Supabase Studio
-- SQL Editor) pour confirmer que le UNIQUE INDEX peut être créé sans
-- collision :
--
--   SELECT lower(email) AS email_lower, count(*) AS n
--   FROM public.users
--   WHERE email IS NOT NULL
--   GROUP BY lower(email)
--   HAVING count(*) > 1;
--
--   → doit retourner 0 ligne. Si > 0 : NE PAS apply, cleanup manuel d'abord.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. UNIQUE preventive sur public.users.email (case-insensitive)
-- -----------------------------------------------------------------------------
-- Index partial : NULL toléré (defensive — audit dit 0 NULL, mais le schema
-- initial 20260419000000 déclare email text nullable). lower() pour
-- case-insensitivity (un user peut pas créer "Foo@x.com" si "foo@x.com" existe
-- déjà). Pattern aligné producer_interests_email_key (cf. 20260428300000).
create unique index users_email_unique
  on public.users (lower(email))
  where email is not null;

-- -----------------------------------------------------------------------------
-- 2. Table email_change_otp_codes — OTP éphémères 6 chiffres
-- -----------------------------------------------------------------------------
-- Un row par étape (current/new) du flow. consumed_at marque la validation
-- réussie. attempts cap les saisies fausses (5 → invalidation forcée du row).
-- expires_at fixé à created_at + 10 min côté code applicatif (PR2).
create table public.email_change_otp_codes (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  step         text        not null check (step in ('current', 'new')),
  -- Email destinataire de l'OTP. step=current → email actuel auth.users.email.
  -- step=new → nouvelle adresse cible saisie par l'user.
  email        text        not null,
  -- HMAC-SHA256 du code 6 chiffres (jamais le code en clair en DB).
  code_hash    text        not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  -- Tentatives de saisie (cap 5 = invalidation, force re-request).
  attempts     int         not null default 0,
  created_at   timestamptz not null default now(),
  ip_address   inet,
  user_agent   text
);

-- Lookup actif par (user_id, step) : trouver l'OTP non consommé pour l'étape
-- courante. Partial sur consumed_at NULL pour minimiser la taille.
create index idx_email_change_otp_user_step
  on public.email_change_otp_codes (user_id, step)
  where consumed_at is null;

-- Lookup expiration : utile pour le futur cron de purge (T-016 séparé).
create index idx_email_change_otp_expires_at
  on public.email_change_otp_codes (expires_at)
  where consumed_at is null;

alter table public.email_change_otp_codes enable row level security;
-- Pas de policy : service_role only (helpers PR2). Aucun client authenticated
-- ne doit lire ou écrire cette table.

-- -----------------------------------------------------------------------------
-- 3. Table email_change_undo_tokens — annulation post-change (7 jours)
-- -----------------------------------------------------------------------------
-- Crée à la complétion du change_email (step=new validé), envoie un mail à
-- l'ancien email avec lien CTA /api/email-change/undo?token=<brut>. Token
-- brut comparé constant-time vs token_hash. used_at = idempotence (un même
-- token ne peut être consommé qu'une fois).
--
-- old_email/new_email en clair : nécessaires à l'opération undo (restaurer
-- old_email côté auth.users + cohérence audit forensique). Pas hashables —
-- ce sont les valeurs à restaurer, pas des secrets cryptographiques.
create table public.email_change_undo_tokens (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  old_email    text        not null,
  new_email    text        not null,
  -- HMAC-SHA256 du token brut transitant en query string (jamais en clair).
  token_hash   text        not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  ip_address   inet,
  user_agent   text
);

-- Lookup forensique : tous les undo tokens d'un user (admin debug).
create index idx_email_change_undo_user_id
  on public.email_change_undo_tokens (user_id);

-- Lookup principal : la route /api/email-change/undo cherche par token_hash.
-- Partial sur used_at NULL pour ignorer les tokens déjà consommés et
-- minimiser la taille de l'index.
create index idx_email_change_undo_token_hash
  on public.email_change_undo_tokens (token_hash)
  where used_at is null;

alter table public.email_change_undo_tokens enable row level security;
-- Pas de policy : service_role only (route /api/email-change/undo livrée PR3).

commit;
