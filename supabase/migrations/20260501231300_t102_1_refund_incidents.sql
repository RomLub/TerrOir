-- =============================================================================
-- TerrOir — tables refund_incidents + refund_incident_attempts (T-102.1)
-- =============================================================================
-- Pose la fondation data du chantier T-102 (cron retry-failed-refunds dette).
-- Aujourd'hui le cron retry-failed-refunds dérive l'état (attempt count, kind,
-- resolved/exhausted) entièrement depuis `audit_logs.event_type` + group by
-- `metadata->>'order_id'` + count côté JS (cf. lib/cron/build-retry-targets.ts).
-- C'est la dette à payer : opaque, fragile, non-indexable, pas de dashboard.
--
-- Cette migration introduit la source-of-truth dédiée :
--
--   1. public.refund_incidents (1 row par couple `(order_id, kind)`,
--      lifecycle status pending → retrying → succeeded|exhausted|
--      manually_resolved|aborted). Cache dénormalisé last_error_code/message
--      pour query rapide dashboard sans JOIN.
--
--   2. public.refund_incident_attempts (1 row immutable par appel
--      stripe.refunds.create). Historique forensique avec stripe_request_id
--      pour debug avec support Stripe. Cascade DELETE depuis le parent.
--
-- Stratégie de coexistence avec audit_logs (décision orchestrateur, hybride) :
-- audit_logs garde une row par transition pour traçabilité forensique
-- RGPD/PCI (double écriture), mais NE sert plus de source pour l'état du
-- cron retry. Les chantiers T-102.2+ feront le switch côté code.
--
-- Périmètre T-102.1 (CETTE migration) : pose des 2 tables + RLS + indexes
-- seuls. Aucune connexion au code prod (cron, retry helper, 3 paths refund)
-- — celle-ci viendra dans T-102.2 (cron) et T-102.3 (3 paths writes).
-- L'application reste fonctionnellement identique post-migration ; les
-- nouvelles tables sont vides et inutilisées tant que T-102.2 n'a pas
-- branché les writes.
--
-- Trigger générique set_updated_at() : DÉJÀ POSÉ par migration
-- 20260429030000_payouts_updated_at_error_msg.sql (réutilisable cf. son
-- commentaire). Cette migration se contente d'ajouter le trigger sur
-- refund_incidents qui appelle la fonction existante.
--
-- RLS : pattern audit_logs/disputes — admin only via lookup
-- public.admin_users.id = auth.uid(). Aucune policy INSERT/UPDATE/DELETE :
-- service_role bypass natif (writes via helpers backend uniquement, à
-- introduire dans T-102.2/3). audit_logs et webhook_events_processed
-- suivent la même convention.
--
-- Group key composite (order_id, kind) : 1 incident par (commande, path
-- d'origine refund). Si historiquement une même order voit échec admin
-- ET échec timeout (cas patho mais théorique), 2 incidents distincts —
-- résolus indépendamment. Aligné avec le compteur kind-séparé existant
-- côté lib/cron/build-retry-targets.ts (T-412).
--
-- closure_reason côté orders : INTACT. Double écriture maintenue pour ne
-- pas casser stats publiques + dashboards producer + RGPD purge. Si
-- redondance jugée gênante plus tard, chantier dédié.
-- =============================================================================

begin;

-- 1. Trigger sur refund_incidents (la fonction set_updated_at() existe déjà,
--    cf. migration 20260429030000_payouts_updated_at_error_msg.sql).

-- 2. Table refund_incidents (lifecycle, état actuel)
create table if not exists public.refund_incidents (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid not null references public.orders(id),
  kind                     text not null check (kind in ('revival', 'admin', 'timeout')),
  payment_intent_id        text not null,
  consumer_id              uuid references public.users(id) on delete set null,
  status                   text not null default 'pending'
                           check (status in ('pending', 'retrying', 'succeeded', 'exhausted', 'manually_resolved', 'aborted')),
  retry_count              int not null default 0 check (retry_count >= 0),
  max_retries              int not null default 3 check (max_retries > 0),
  last_error_code          text,
  last_error_message       text,
  blocked_reason           text,
  resolution_note          text,
  first_failed_event_at    timestamptz not null,
  resolved_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (order_id, kind)
);

create index if not exists refund_incidents_status_kind_open_idx
  on public.refund_incidents (status, kind)
  where status in ('pending', 'retrying');

create index if not exists refund_incidents_consumer_id_idx
  on public.refund_incidents (consumer_id);

create index if not exists refund_incidents_created_at_idx
  on public.refund_incidents (created_at desc);

create index if not exists refund_incidents_order_id_idx
  on public.refund_incidents (order_id);

drop trigger if exists refund_incidents_set_updated_at on public.refund_incidents;
create trigger refund_incidents_set_updated_at
  before update on public.refund_incidents
  for each row execute function public.set_updated_at();

alter table public.refund_incidents enable row level security;

drop policy if exists "refund_incidents admin read" on public.refund_incidents;
create policy "refund_incidents admin read"
  on public.refund_incidents
  for select
  to authenticated
  using (exists (
    select 1 from public.admin_users where id = auth.uid()
  ));

-- 3. Table refund_incident_attempts (immutable, historique tentatives)
create table if not exists public.refund_incident_attempts (
  id                     uuid primary key default gen_random_uuid(),
  refund_incident_id     uuid not null references public.refund_incidents(id) on delete cascade,
  attempt_number         int not null check (attempt_number > 0),
  outcome                text not null check (outcome in ('failed', 'succeeded')),
  stripe_error_code      text,
  stripe_error_type      text,
  stripe_error_message   text,
  stripe_request_id      text,
  stripe_refund_id       text,
  attempted_at           timestamptz not null default now(),
  unique (refund_incident_id, attempt_number)
);

create index if not exists refund_incident_attempts_incident_id_idx
  on public.refund_incident_attempts (refund_incident_id);

create index if not exists refund_incident_attempts_attempted_at_idx
  on public.refund_incident_attempts (attempted_at desc);

alter table public.refund_incident_attempts enable row level security;

drop policy if exists "refund_incident_attempts admin read" on public.refund_incident_attempts;
create policy "refund_incident_attempts admin read"
  on public.refund_incident_attempts
  for select
  to authenticated
  using (exists (
    select 1 from public.admin_users where id = auth.uid()
  ));

-- 4. Comments
comment on table public.refund_incidents is
  'Source-of-truth pour les remboursements Stripe ratés (T-102 chantier). Lifecycle: pending → retrying → succeeded|exhausted|manually_resolved|aborted. Group key composite (order_id, kind). Alimentée par les 3 paths refund (admin manuel, cron timeout, résurrection P1) et par le cron retry-failed-refunds.';

comment on column public.refund_incidents.kind is
  'Path d''origine du refund : revival (résurrection P1 bloquée stock/slot), admin (refund manuel via /api/stripe/refund), timeout (cron order-timeout sur commande non-confirmée).';

comment on column public.refund_incidents.status is
  'État: pending (ouvert pas encore retenté), retrying (>=1 tentative échouée, retry futur prévu), succeeded (refund Stripe confirmé), exhausted (max_retries atteint sans succès), manually_resolved (admin a marqué résolu hors-cron), aborted (circuit breaker T-102.5).';

comment on column public.refund_incidents.first_failed_event_at is
  'Timestamp du premier échec refund original (distinct de created_at de la row). Utile pour SLA dashboard.';

comment on column public.refund_incidents.last_error_code is
  'Cache dénormalisé du stripe_error_code de la dernière tentative. Source-of-truth = refund_incident_attempts. Alimenté par classification T-102.2.';

comment on column public.refund_incidents.last_error_message is
  'Cache dénormalisé du stripe_error_message de la dernière tentative. Source-of-truth = refund_incident_attempts.';

comment on column public.refund_incidents.blocked_reason is
  'Pour kind=revival uniquement : raison du blocage résurrection (blocked_stock | blocked_slot). NULL pour admin/timeout.';

comment on column public.refund_incidents.resolution_note is
  'Note libre admin lors d''une résolution manuelle (status=manually_resolved). NULL sinon.';

comment on table public.refund_incident_attempts is
  'Historique immutable des tentatives de refund Stripe par incident. INSERT-only. Une row par appel stripe.refunds.create (succès ou échec). Permet la classification d''erreurs et le debug avec support Stripe via stripe_request_id.';

commit;
