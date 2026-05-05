-- =============================================================================
-- TerrOir — Audit Email H-3 + M-5 (2026-05-05) — table email_suppressions
--                                                + ALTER notifications.statut
-- =============================================================================
-- Référence : docs/audits/audit-email-deliverability-2026-05-05.md (H-3 + M-5)
-- Récap     : docs/fixes/fix-email-h3-m5-webhook-resend-2026-05-05.md
--
-- Contexte H-3 + M-5 conjoints :
--   - Aucun webhook Resend entrant aujourd'hui → notifications.statut='sent'
--     reflète juste le 200 du POST Resend, pas le statut réel de delivery.
--   - Aucune visibilité sur email.bounced / email.complained / delivery_delayed.
--   - Aucun mécanisme de suppression list automatique → si un consumer marque
--     un email TerrOir comme spam, on continue à pousser pour toutes ses
--     notifications futures → dégradation lente reputation → blacklist Gmail
--     /Yahoo à terme.
--
-- Cette migration adresse les pré-requis DB du fix H-3 + M-5 :
--
--   1. CREATE TABLE public.email_suppressions
--      PK = email (lowercase, normalisé applicativement). 1 row par email
--      suppressed. UPSERT depuis le webhook handler (hard_bounce immédiat,
--      complained immédiat, soft_bounce_threshold après 3 soft bounces).
--      Skill list-management.md : « Always check suppression before sending ».
--
--   2. ALTER public.notifications statut CHECK
--      Ajoute 'skipped' au check. Quand canSendTo() return false dans
--      sendTemplate (lib/resend/send.ts, fix Lot 4), on INSERT une row
--      notifications statut='skipped' metadata.skip_reason='suppressed' pour
--      traçabilité forensique (sinon on perd la trace : l'envoi n'a pas eu
--      lieu mais le caller doit pouvoir auditer pourquoi).
--
-- RLS : service-role only (pas de policy). Cohérent avec
-- webhook_events_processed (mig 20260429000000), audit_logs (mig
-- 20260427100000) — tables backend manipulées exclusivement via helpers
-- admin (lib/resend/suppressions.ts). Les anon/authenticated n'ont aucun
-- usage sur cette table.
--
-- Index created_at posé pour faciliter purges futures (cohérent avec
-- webhook_events_processed.processed_at). Pas de purge dans cette migration
-- — la suppression d'un row reflète une décision business (consumer demande
-- réintégration, ou TTL hard_bounce >12 mois → re-tester).
--
-- Pas de seed depuis Resend API (l'historique des bounces/complaints est
-- accessible via GET /audiences mais pas exposé en mass). À traiter en
-- chantier futur si besoin (volume actuel <30 envois/jour → table vide
-- en pratique tant que le webhook tourne quelques semaines).
-- =============================================================================

begin;

-- 1. CREATE TABLE email_suppressions ------------------------------------------

create table if not exists public.email_suppressions (
  email              text primary key,
  reason             text not null check (
    reason in (
      'hard_bounce',           -- email.bounced (Permanent) → suppression immédiate
      'complained',            -- email.complained → suppression IMMÉDIATE (légal CASL)
      'soft_bounce_threshold', -- 3 soft bounces consécutifs → suppression
      'soft_bounce_pending',   -- staging counter < threshold (n'active PAS canSendTo=false)
      'manual'                 -- entrée admin manuelle (réservé)
    )
  ),
  soft_bounce_count  int  not null default 0,
  source_resend_id   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_email_suppressions_created_at
  on public.email_suppressions (created_at);

alter table public.email_suppressions enable row level security;

-- Pas de policy : service-role only. Convention identique à
-- webhook_events_processed et audit_logs.

comment on table public.email_suppressions is
  'Suppression list emails (hard bounces, complaints, soft bounce threshold). '
  'Backend-only via lib/resend/suppressions.ts. Audit Email H-3 + M-5 (2026-05-05).';

-- 2. ALTER notifications.statut CHECK -----------------------------------------
--
-- statut ENUM passe de ('sent', 'failed') à ('sent', 'failed', 'skipped').
-- 'skipped' = sendTemplate a court-circuité l'envoi parce que canSendTo a
-- retourné false (email présent dans email_suppressions). Pas un échec
-- (l'erreur n'est pas applicative) mais à tracer pour audit forensique.

alter table public.notifications
  drop constraint if exists notifications_statut_check;

alter table public.notifications
  add constraint notifications_statut_check
  check (statut in ('sent', 'failed', 'skipped'));

commit;
