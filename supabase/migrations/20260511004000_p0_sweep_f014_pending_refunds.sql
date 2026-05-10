-- =============================================================================
-- TerrOir — F-014 v2 : workflow approval admin pour refund producer > cap
-- =============================================================================
-- Audit pré-launch 2026-05 (F-014) : P0-TB a posé un cap dur 500€ + 403
-- sur self-refund producer. Sweep P0 escalation : remplacer le 403 par un
-- workflow approval admin (option 3 Romain).
--
-- Flow :
--   1. Producer POST /api/stripe/refund avec amount > cap → INSERT
--      pending_refunds (status='pending') + audit log producer_refund_pending_created
--      + email admin URGENT.
--   2. Admin /admin/refunds/pending : liste + UI approve/deny.
--   3. Admin approve → server action approvePendingRefund :
--      a. UPDATE pending_refunds SET status='approved', decided_at, decided_by
--      b. Déclenche flow refund Stripe (helper extrait du route handler)
--      c. Audit log producer_refund_admin_approved + email producer.
--   4. Admin deny → server action denyPendingRefund :
--      a. UPDATE pending_refunds SET status='denied', decided_at, decided_by
--      b. Audit log producer_refund_admin_denied + email producer.
--   5. Cron refund-expire-pending (J+7) : auto-expire si non-décidé → status='expired'
--      + email producer + email admin.
--
-- Idempotence : double-approve / double-deny no-op (status guard inside server
-- actions). Lookup unique par (id) — pas de dedup composite, c'est le producer
-- qui POST et chaque request crée son row.
--
-- RLS :
--   • Admin read/write tout
--   • Producer read uniquement ses propres rows (audit forensique côté
--     producer dashboard, V1.x)
--   • service_role bypass tout (cron, server actions)
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pending_refund_status') then
    create type public.pending_refund_status as enum (
      'pending',
      'approved',
      'denied',
      'expired'
    );
  end if;
end $$;

create table if not exists public.pending_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  producer_id uuid not null references public.producers(id) on delete cascade,
  amount_eur numeric(12, 2) not null check (amount_eur > 0),
  reason text,
  status public.pending_refund_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pending_refunds is
  'F-014 v2 (audit P0 sweep 2026-05-11) — Workflow approval admin pour refund producer au-delà du cap PRODUCER_REFUND_CAP_EUR. Le producer POST /api/stripe/refund avec amount > cap crée un row pending ; admin /admin/refunds/pending approve ou deny.';

comment on column public.pending_refunds.amount_eur is
  'Montant EUR exact du refund demandé (= orders.montant_total). Snapshot au moment de la demande pour traçabilité.';

comment on column public.pending_refunds.decided_by is
  'auth.users.id de l''admin qui a tranché. ON DELETE SET NULL pour préserver l''audit forensique même si l''admin est supprimé.';

create index if not exists pending_refunds_status_idx on public.pending_refunds(status);
create index if not exists pending_refunds_order_id_idx on public.pending_refunds(order_id);
create index if not exists pending_refunds_producer_id_idx on public.pending_refunds(producer_id);
create index if not exists pending_refunds_requested_at_idx on public.pending_refunds(requested_at desc);

-- updated_at trigger
create or replace function public.pending_refunds_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.pending_refunds_set_updated_at() from public;

drop trigger if exists pending_refunds_set_updated_at_trigger on public.pending_refunds;
create trigger pending_refunds_set_updated_at_trigger
before update on public.pending_refunds
for each row
execute function public.pending_refunds_set_updated_at();

-- RLS
alter table public.pending_refunds enable row level security;
alter table public.pending_refunds force row level security;

drop policy if exists "pending_refunds admin all" on public.pending_refunds;
create policy "pending_refunds admin all"
on public.pending_refunds
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "pending_refunds producer read own" on public.pending_refunds;
create policy "pending_refunds producer read own"
on public.pending_refunds
for select
using (
  producer_id in (
    select id from public.producers where user_id = (select auth.uid())
  )
);

revoke all on table public.pending_refunds from public, anon;
grant select, insert, update on table public.pending_refunds to authenticated;
grant all on table public.pending_refunds to service_role;
