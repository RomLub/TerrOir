-- Chantier 3 (Leads) — Phase 1 : colonnes CRM sur producer_interests +
-- table d'historique des interactions producer_interest_followups.
-- Forward-only, idempotent.

-- ============================================================================
-- 1. Colonnes CRM sur producer_interests
-- ============================================================================
alter table public.producer_interests
  add column if not exists assigned_to uuid null references public.admin_users(id) on delete set null,
  add column if not exists first_contact_at timestamptz null,
  add column if not exists last_contact_at timestamptz null,
  add column if not exists next_follow_up_at timestamptz null,
  add column if not exists abandoned_at timestamptz null,
  add column if not exists abandoned_reason text null,
  add column if not exists current_step smallint not null default 1,
  add column if not exists prefill_token text null,
  add column if not exists prefill_token_expires_at timestamptz null;

-- CHECK current_step ∈ [1..6] (drop+recreate pour idempotence forward-only).
alter table public.producer_interests
  drop constraint if exists producer_interests_current_step_check;
alter table public.producer_interests
  add constraint producer_interests_current_step_check
  check (current_step between 1 and 6);

-- prefill_token unique. Index partiel : Postgres autorise plusieurs NULL dans
-- une UNIQUE, mais on reste explicite (WHERE NOT NULL) pour la lisibilité.
create unique index if not exists producer_interests_prefill_token_key
  on public.producer_interests (prefill_token)
  where prefill_token is not null;

-- ============================================================================
-- 2. Backfill current_step depuis statut (one-shot).
--    new → 1 (déjà le défaut), contacted → 2, onboarded → 6.
--    Guardé sur current_step = 1 (le défaut) pour rester idempotent : une fois
--    une étape avancée manuellement, ce backfill ne la réécrit jamais.
-- ============================================================================
update public.producer_interests
set current_step = case statut
  when 'contacted' then 2
  when 'onboarded' then 6
  else current_step
end
where current_step = 1
  and statut in ('contacted', 'onboarded');

-- ============================================================================
-- 3. Table producer_interest_followups (historique des interactions lead).
--    Une ligne = une interaction (relance auto, contact manuel, réponse reçue).
-- ============================================================================
create table if not exists public.producer_interest_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.producer_interests(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  channel text not null,            -- email | phone | rdv
  direction text not null,          -- outbound | inbound
  is_automatic boolean not null default false,
  relance_step smallint null,       -- 1|2|3 pour les relances auto, NULL sinon
  note text null,
  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.producer_interest_followups
  drop constraint if exists producer_interest_followups_channel_check;
alter table public.producer_interest_followups
  add constraint producer_interest_followups_channel_check
  check (channel in ('email', 'phone', 'rdv'));

alter table public.producer_interest_followups
  drop constraint if exists producer_interest_followups_direction_check;
alter table public.producer_interest_followups
  add constraint producer_interest_followups_direction_check
  check (direction in ('outbound', 'inbound'));

alter table public.producer_interest_followups
  drop constraint if exists producer_interest_followups_relance_step_check;
alter table public.producer_interest_followups
  add constraint producer_interest_followups_relance_step_check
  check (relance_step is null or relance_step between 1 and 3);

create index if not exists producer_interest_followups_lead_occurred_idx
  on public.producer_interest_followups (lead_id, occurred_at desc);

-- ============================================================================
-- 4. RLS : lecture + insertion admin. service_role bypass RLS nativement
--    (cron relances), donc pas de policy service_role nécessaire.
-- ============================================================================
alter table public.producer_interest_followups enable row level security;

drop policy if exists "producer_interest_followups admin read" on public.producer_interest_followups;
create policy "producer_interest_followups admin read"
  on public.producer_interest_followups
  for select to authenticated
  using (public.is_admin());

drop policy if exists "producer_interest_followups admin insert" on public.producer_interest_followups;
create policy "producer_interest_followups admin insert"
  on public.producer_interest_followups
  for insert to authenticated
  with check (public.is_admin());
