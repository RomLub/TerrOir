-- =============================================================================
-- TerrOir — table public.disputes (T-403 audit #2 Stripe)
-- =============================================================================
-- Tracking des chargebacks Stripe pour les commandes consumer. Une dispute
-- correspond à une contestation client auprès de sa banque sur un paiement
-- déjà encaissé. Stripe nous prévient via webhook charge.dispute.created,
-- nous donne une deadline (evidence_due_by, typiquement 7-21 jours) pour
-- soumettre des preuves, puis notifie l'évolution via charge.dispute.updated
-- et la résolution finale via charge.dispute.closed.
--
-- Sans réponse avant la deadline, Stripe perd automatiquement la dispute et
-- l'argent est retiré du compte plateforme TerrOir + commission Stripe payée.
-- D'où nécessité d'alerte admin proactive (pattern dual email + notification
-- placeholder Bundle 3, cf. lib/stripe/handle-dispute-created.ts).
--
-- Volume estimé < 5/an (circuit court alimentaire, panier ~50€, fraude rare),
-- mais criticité élevée par dispute. Table dédiée plutôt que colonnes orders.* :
--   - 1:N possible (2 chargebacks successifs sur cartes différentes, rare)
--   - Workflow multi-step nécessite timestamps par transition
--   - RLS dédiée admin only (vs RLS orders mixed consumer/producer)
--   - Anticipation UI admin gestion disputes future
--
-- RLS : admin lecture seule (lookup via admin_users.id = auth.uid(), cohérent
-- avec audit_logs et le pattern projet). service_role bypass natif pour les
-- écritures depuis les handlers webhook (lib/stripe/handle-dispute-*.ts).
--
-- Pas de policy INSERT/UPDATE/DELETE pour authenticated : seul service_role
-- (qui bypass RLS) écrit. Évite la falsification de l'historique disputes
-- côté client. Mêmes conventions que audit_logs (20260427100000) et
-- webhook_events_processed (20260429000000).
-- =============================================================================

begin;

create table if not exists public.disputes (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id),
  stripe_dispute_id   text not null unique,
  stripe_charge_id    text,
  status              text not null default 'needs_response'
                      check (status in (
                        'needs_response',          -- evidence à soumettre
                        'under_review',            -- evidence soumise, Stripe analyse
                        'won',                     -- gagnée, argent récupéré
                        'lost',                    -- perdue, argent retiré
                        'warning_closed',          -- Visa CE3.0 warning closed
                        'warning_needs_response',  -- Visa CE3.0 warning à traiter
                        'warning_under_review'     -- Visa CE3.0 warning en cours
                      )),
  reason              text,                       -- fraudulent / duplicate / product_not_received / etc.
  amount              numeric(10, 2) not null,    -- montant contesté (euros)
  currency            text not null default 'eur',
  evidence_due_by     timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  closed_at           timestamptz
);

create index if not exists disputes_order_id_idx
  on public.disputes (order_id);

create index if not exists disputes_status_open_idx
  on public.disputes (status)
  where closed_at is null;

create index if not exists disputes_stripe_dispute_id_idx
  on public.disputes (stripe_dispute_id);

alter table public.disputes enable row level security;

-- Lecture : admin only (cohérent avec audit_logs et le pattern admin_users.id
-- = auth.uid() utilisé ailleurs dans le schéma, cf 20260421100000 + 20260427100000).
drop policy if exists "disputes admin read" on public.disputes;
create policy "disputes admin read"
  on public.disputes
  for select
  to authenticated
  using (exists (
    select 1 from public.admin_users where id = auth.uid()
  ));

-- Pas de policy INSERT/UPDATE/DELETE : seul service_role (bypass RLS) écrit.
-- Convention identique à audit_logs et webhook_events_processed.

comment on table public.disputes is
  'Chargebacks Stripe pour les commandes consumer. Alimentée par les webhooks charge.dispute.{created,updated,closed} (T-403 audit #2 Stripe).';

comment on column public.disputes.status is
  'État Stripe dispute : needs_response (evidence à soumettre) -> under_review (evidence soumise) -> won/lost (final) | warning_* pour Visa Compelling Evidence 3.0.';

commit;
